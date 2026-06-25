"""
实体索引服务 v2：从 dandanplay 响应解析 anime/bangumi/episode 实体，
并维护 api_response_entities 与 episode_links。
"""
import json
import logging
from typing import Any, Dict, List, Optional

from src.database import get_db_sync
from src.models_v2 import ApiResponseEntity, EpisodeLink
from src.models_v2.base import now

logger = logging.getLogger(__name__)


class EntityIndexService:
    """响应实体索引服务"""

    def index_from_response(self, api_path: str, cache_key: str,
                            body: str) -> int:
        """解析响应体，写入 api_response_entities，返回新增/更新数量"""
        try:
            data = json.loads(body) if isinstance(body, str) else body
        except Exception:
            return 0

        entities: List[Dict[str, Any]] = []
        # 搜索动画 / 番剧详情
        if "/search/anime" in api_path or "/search/episodes" in api_path:
            for a in (data.get("animes") or []):
                entities.append({
                    "type": "anime",
                    "id": str(a.get("animeId") or a.get("bangumiId") or ""),
                    "title": a.get("animeTitle") or a.get("title"),
                    "raw": a,  # 保留上游原始对象（含 imageUrl/typeDescription 等）
                })
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
                entities.append({
                    "type": "episode",
                    "id": str(ep.get("episodeId") or ""),
                    "title": bangumi.get("animeTitle"),
                    "episode_title": ep.get("episodeTitle"),
                    "raw": ep,
                })

        if not entities:
            return 0

        db = get_db_sync()
        count = 0
        try:
            current = now()
            for e in entities:
                if not e.get("id"):
                    continue
                row = db.query(ApiResponseEntity).filter(
                    ApiResponseEntity.entity_type == e["type"],
                    ApiResponseEntity.entity_id == e["id"],
                ).first()
                if not row:
                    row = ApiResponseEntity(
                        entity_type=e["type"], entity_id=e["id"],
                        first_seen_at=current,
                    )
                    db.add(row)
                row.title = e.get("title")
                row.episode_title = e.get("episode_title")
                row.api_path = api_path
                row.cache_key = cache_key
                # 写入上游原始数据用于溯源/媒体库提取封面简介
                if e.get("raw") is not None:
                    row.raw_json = e["raw"]
                row.last_seen_at = current
                count += 1
            db.commit()
            return count
        except Exception as ex:
            logger.error(f"❌ 实体索引失败: {ex}")
            db.rollback()
            return 0
        finally:
            db.close()


class EpisodeLinkService:
    """集数链接服务"""

    def link_from_response(self, api_path: str, cache_key: str, body: str) -> int:
        """从 /bangumi/{id} 响应解析分集并建立 episode_links，返回新增/更新数量"""
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

        db = get_db_sync()
        count = 0
        try:
            for ep in episodes:
                episode_id = str(ep.get("episodeId") or "")
                if not episode_id:
                    continue
                ep_number = str(ep.get("episodeNumber") or "")
                row = db.query(EpisodeLink).filter(
                    EpisodeLink.dandan_episode_id == episode_id
                ).first()
                if not row:
                    row = EpisodeLink(
                        local_title=anime_title or "",
                        dandan_episode_id=episode_id,
                        match_source="bangumi",
                        source_cache_key=cache_key,
                    )
                    db.add(row)
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
            db.commit()
            return count
        except Exception as ex:
            logger.error(f"❌ 集数链接解析失败: {ex}")
            db.rollback()
            return 0
        finally:
            db.close()

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
