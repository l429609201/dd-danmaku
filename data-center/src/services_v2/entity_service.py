"""
实体索引服务 v2：从 dandanplay 响应解析 anime/bangumi/episode 实体，
并维护 api_response_entities 与 episode_links。
"""
import json
import logging
from typing import Any, Dict, List, Optional

from src.database import get_db_sync
from src.models_v2 import ApiResponseEntity, EpisodeLink, MediaLibrary
from src.models_v2.base import now

logger = logging.getLogger(__name__)


class EntityIndexService:
    """响应实体索引服务"""

    def index_from_response(self, api_path: str, cache_key: str,
                            body: str) -> int:
        """解析响应体，写入 api_response_entities，返回新增/更新数量（自管事务）"""
        db = get_db_sync()
        try:
            n = self._index_with_db(db, api_path, cache_key, body)
            db.commit()
            return n
        except Exception as ex:
            logger.error(f"❌ 实体索引失败: {ex}")
            db.rollback()
            return 0
        finally:
            db.close()

    def _index_with_db(self, db, api_path: str, cache_key: str, body: str) -> int:
        """解析并写入实体（不提交事务，供批量复用共享 session）"""
        try:
            data = json.loads(body) if isinstance(body, str) else body
        except Exception:
            return 0

        entities: List[Dict[str, Any]] = []
        # 搜索动画 / 番剧详情
        if "/search/anime" in api_path or "/search/episodes" in api_path:
            for a in (data.get("animes") or []):
                a_id = str(a.get("animeId") or a.get("bangumiId") or "")
                # anime 实体的 raw 剔除 episodes：整季列表已按集拆成独立 episode 实体，
                # 再冗余存一份会让单行 JSON 膨胀到几十 KB（现网最多 201 集）
                anime_meta = {k: v for k, v in a.items() if k != "episodes"}
                entities.append({
                    "type": "anime",
                    "id": a_id,
                    "title": a.get("animeTitle") or a.get("title"),
                    "raw": anime_meta,
                })
                # search/episodes 的响应里 animes[].episodes[] 同样是可复用的单集数据，
                # 原先只存了 anime 实体、整季明细被丢弃，导致带 episode=N 查询无法本地拼装。
                for ep in (a.get("episodes") or []):
                    entities.append(self._episode_entity(
                        ep, a_id, a.get("animeTitle") or a.get("title")))
        elif "/bangumi/" in api_path:
            bangumi = data.get("bangumi") or data
            anime_id = str(bangumi.get("animeId") or "")
            if anime_id:
                # 番剧详情：raw 存除 episodes 外的元数据（封面/简介/评分等），避免体积过大
                bangumi_meta = {k: v for k, v in bangumi.items() if k != "episodes"}
                entities.append({
                    "type": "bangumi", "id": anime_id,
                    "title": bangumi.get("animeTitle") or bangumi.get("title"),
                    "raw": bangumi_meta,
                })
            for ep in (bangumi.get("episodes") or []):
                entities.append(self._episode_entity(
                    ep, anime_id, bangumi.get("animeTitle")))

        if not entities:
            return 0

        count = 0
        current = now()
        # 批量化：按 (type, id) 一次性取出已存在实体，避免逐个 query（N 次往返）
        wanted = {(e["type"], e["id"]) for e in entities if e.get("id")}
        existing = {}
        if wanted:
            types = {t for t, _ in wanted}
            ids = {i for _, i in wanted}
            for row in db.query(ApiResponseEntity).filter(
                ApiResponseEntity.entity_type.in_(types),
                ApiResponseEntity.entity_id.in_(ids),
            ).all():
                existing[(row.entity_type, row.entity_id)] = row

        for e in entities:
            if not e.get("id"):
                continue
            key = (e["type"], e["id"])
            row = existing.get(key)
            if not row:
                row = ApiResponseEntity(
                    entity_type=e["type"], entity_id=e["id"],
                    first_seen_at=current,
                )
                db.add(row)
                existing[key] = row  # 防止同响应内重复实体再次新建
            row.title = e.get("title")
            row.episode_title = e.get("episode_title")
            row.api_path = api_path
            row.cache_key = cache_key
            # 归属与集号：拼装整季/取指定集全靠这两列，非空才覆盖，
            # 避免后续某个残缺响应把已有的归属关系清空
            if e.get("anime_id"):
                row.anime_id = e["anime_id"]
            if e.get("episode_number"):
                row.episode_number = e["episode_number"]
            # 写入上游原始数据用于溯源/媒体库提取封面简介
            if e.get("raw") is not None:
                row.raw_json = e["raw"]
            row.last_seen_at = current
            count += 1
            # anime/bangumi 实体同步进媒体库主档（含海报/类型/简介）
            if e["type"] in ("anime", "bangumi") and isinstance(e.get("raw"), dict):
                self._upsert_media(db, e["id"], e["raw"], e["type"], current)
        return count

    @staticmethod
    def _episode_entity(ep: dict, anime_id: str, anime_title: Optional[str]) -> dict:
        """把上游单集对象转成待写入的 episode 实体。

        anime_id 由调用方从父级对象取（search 的 animes[] 或 bangumi 详情），
        不从 episodeId 做算术反推——现网虽有 episodeId = animeId*10000+集号 的规律，
        但超过 9999 集或特殊编号（SP/OVA）会破裂。
        """
        ep_id = str(ep.get("episodeId") or "")
        # 集号字段上游不统一：优先 episodeNumber，回退 episodeIndex/episodeNo
        raw_no = (ep.get("episodeNumber") if ep.get("episodeNumber") is not None
                  else ep.get("episodeIndex") if ep.get("episodeIndex") is not None
                  else ep.get("episodeNo"))
        ep_no = str(raw_no).strip() if raw_no is not None and str(raw_no).strip() else None
        # 兜底：上游未给集号时，用 episodeId 末 4 位推算（仅在有 anime_id 佐证时）
        if not ep_no and ep_id and anime_id and ep_id.startswith(anime_id):
            suffix = ep_id[len(anime_id):]
            if suffix.isdigit():
                ep_no = str(int(suffix))
        return {
            "type": "episode",
            "id": ep_id,
            "title": anime_title,
            "episode_title": ep.get("episodeTitle"),
            "anime_id": anime_id or None,
            "episode_number": ep_no,
            "raw": ep,
        }

    def _upsert_media(self, db, anime_id: str, raw: dict, source: str, current):
        """从 anime/bangumi 原始对象抽取媒体信息，upsert 到 media_library。
        在同一事务内执行（不单独 commit）；字段以非空为准增量更新。"""
        if not anime_id:
            return
        # 兼容 search(anime 对象) 与 bangumi(详情对象) 两种结构
        title = raw.get("animeTitle") or raw.get("title")
        image_url = raw.get("imageUrl")
        type_code = raw.get("type")
        type_desc = raw.get("typeDescription")
        summary = raw.get("summary")
        rating = raw.get("rating")
        start_date = raw.get("startDate") or raw.get("airDate")
        ep_count = raw.get("episodeCount")
        if ep_count is None and isinstance(raw.get("episodes"), list):
            ep_count = len(raw["episodes"])
        m = db.query(MediaLibrary).filter(MediaLibrary.anime_id == anime_id).first()
        if not m:
            m = MediaLibrary(anime_id=anime_id, first_seen_at=current,
                             source=f"search_anime" if source == "anime" else "bangumi")
            db.add(m)
        # 非空才覆盖，避免后续残缺响应清掉已有海报/简介
        if title:
            m.title = title
        if image_url:
            m.image_url = image_url
        if type_code:
            m.type_code = str(type_code)
        if type_desc:
            m.type_desc = type_desc
        if summary:
            m.summary = summary
        if rating is not None:
            m.rating = str(rating)
        if start_date:
            m.start_date = str(start_date)
        if isinstance(ep_count, int) and ep_count > 0:
            m.episode_count = ep_count
        m.last_seen_at = current


class EpisodeLinkService:
    """集数链接服务"""

    def link_from_response(self, api_path: str, cache_key: str, body: str) -> int:
        """从 /bangumi/{id} 响应解析分集并建立 episode_links（自管事务）"""
        db = get_db_sync()
        try:
            n = self._link_with_db(db, api_path, cache_key, body)
            db.commit()
            return n
        except Exception as ex:
            logger.error(f"❌ 集数链接解析失败: {ex}")
            db.rollback()
            return 0
        finally:
            db.close()

    def _link_with_db(self, db, api_path: str, cache_key: str, body: str) -> int:
        """解析并写入集数链接（不提交事务，供批量复用共享 session）"""
        if "/bangumi/" not in api_path:
            return 0
        try:
            data = json.loads(body) if isinstance(body, str) else body
        except Exception:
            return 0

        bangumi = data.get("bangumi") or data
        anime_id = str(bangumi.get("animeId") or "")
        anime_title = bangumi.get("animeTitle") or bangumi.get("title")
        episodes = bangumi.get("episodes") or []
        if not episodes:
            return 0

        count = 0
        # 批量化：一次性取出本响应涉及的所有已存在链接，避免逐集 query（N 次往返）
        ep_ids = [str(ep.get("episodeId") or "") for ep in episodes]
        ep_ids = [e for e in ep_ids if e]
        existing = {}
        if ep_ids:
            for row in db.query(EpisodeLink).filter(
                EpisodeLink.dandan_episode_id.in_(ep_ids)
            ).all():
                existing[row.dandan_episode_id] = row

        for ep in episodes:
            episode_id = str(ep.get("episodeId") or "")
            if not episode_id:
                continue
            ep_number = str(ep.get("episodeNumber") or "")
            row = existing.get(episode_id)
            if not row:
                row = EpisodeLink(
                    local_title=anime_title or "",
                    dandan_episode_id=episode_id,
                    match_source="bangumi",
                    source_cache_key=cache_key,
                )
                db.add(row)
                existing[episode_id] = row  # 防止同响应内重复集号再次新建
            # 自动解析的链接不覆盖人工修正
            if not row.is_manual:
                row.episode_number = ep_number or row.episode_number
                row.episode_title = ep.get("episodeTitle") or row.episode_title
                row.dandan_anime_id = anime_id or row.dandan_anime_id
                row.dandan_bangumi_id = anime_id or row.dandan_bangumi_id
                row.anime_title = anime_title or row.anime_title
                row.bangumi_cache_key = cache_key
                row.comment_api_path = f"/api/v2/comment/{episode_id}"
                row.comment_cache_key = f"comment/{episode_id}"
                if not row.confidence:
                    row.confidence = 60
            count += 1
        return count

    def list_links(self, keyword: Optional[str] = None,
                   anime_id: Optional[str] = None,
                   bangumi_id: Optional[str] = None,
                   episode_id: Optional[str] = None,
                   match_source: Optional[str] = None,
                   page: int = 1, page_size: int = 20):
        db = get_db_sync()
        try:
            q = db.query(EpisodeLink)
            if keyword:
                q = q.filter(EpisodeLink.local_title.like(f"%{keyword}%"))
            if anime_id:
                q = q.filter(EpisodeLink.dandan_anime_id == anime_id)
            if bangumi_id:
                q = q.filter(EpisodeLink.dandan_bangumi_id == bangumi_id)
            if episode_id:
                q = q.filter(EpisodeLink.dandan_episode_id == episode_id)
            if match_source:
                q = q.filter(EpisodeLink.match_source == match_source)
            total = q.count()
            items = q.order_by(EpisodeLink.updated_at.desc()) \
                     .offset((page - 1) * page_size).limit(page_size).all()
            return total, items
        finally:
            db.close()

    def create_link(self, data: Dict[str, Any]) -> EpisodeLink:
        db = get_db_sync()
        try:
            row = EpisodeLink(**data)
            db.add(row)
            db.commit()
            db.refresh(row)
            return row
        finally:
            db.close()

    def update_link(self, link_id: int, data: Dict[str, Any],
                    user_id: Optional[int] = None) -> Optional[EpisodeLink]:
        db = get_db_sync()
        try:
            row = db.query(EpisodeLink).filter(EpisodeLink.id == link_id).first()
            if not row:
                return None
            for k, v in data.items():
                if v is not None and hasattr(row, k):
                    setattr(row, k, v)
            # 人工修正标记
            row.is_manual = True
            if user_id:
                row.verified_by_user_id = user_id
            db.commit()
            db.refresh(row)
            return row
        finally:
            db.close()


entity_index_service = EntityIndexService()
episode_link_service = EpisodeLinkService()
