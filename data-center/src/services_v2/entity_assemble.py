"""实体拼装服务 v2：从 api_response_entities「从零拼整」，回源前的最后一道命中机会。

背景：带 episode=N 的 /search/episodes 查询，cache_key 里含集号，
每集都是独立 key，必然 miss 回源——一部 12 集番要打 12 次上游，
而实体表里其实早已存过整季明细（entity_service 已按集拆分入库）。

本模块反向利用这些实体：命中不了整体缓存时，按 (title, episode_number)
从实体表拼出等价响应。命中判定刻意保守——拼不全就返回 None 让它回源，
宁可多打一次上游，也不给客户端残缺的季。
"""
import json
import logging
import re
from typing import Any, Dict, List, Optional
from urllib.parse import unquote

from src.database import get_db_sync
from src.models_v2 import ApiResponseEntity, MediaLibrary

logger = logging.getLogger(__name__)

# 从 cache_key 里抽 anime / episode 参数。
# cache_key 形如 GET:/api/v2/search/episodes?anime=xxx&episode=7
_RE_ANIME = re.compile(r"[?&]anime=([^&]*)")
_RE_EPISODE = re.compile(r"[?&]episode=([^&]*)")
_RE_KEYWORD = re.compile(r"[?&](?:keyword|anime)=([^&]*)")


def parse_search_key(cache_key: str) -> Optional[Dict[str, Any]]:
    """从 cache_key 解析出拼装所需的查询条件。

    只认 /search/episodes 与 /search/anime；其它路径返回 None 表示不参与拼装。
    """
    if not cache_key:
        return None
    if "/api/v2/search/episodes" in cache_key:
        kind = "episodes"
        m = _RE_ANIME.search(cache_key)
    elif "/api/v2/search/anime" in cache_key:
        kind = "anime"
        m = _RE_KEYWORD.search(cache_key)
    else:
        return None
    if not m:
        return None
    # cache_key 里中文是 URL 编码形式，实体表 title 存的是原文，需先解码
    try:
        title = unquote(m.group(1))
    except Exception:
        title = m.group(1)
    title = (title or "").strip()
    if not title:
        return None
    ep_no = None
    if kind == "episodes":
        em = _RE_EPISODE.search(cache_key)
        if em:
            ep_no = (unquote(em.group(1)) or "").strip() or None
    return {"kind": kind, "title": title, "episode": ep_no}


class EntityAssembleService:
    """从实体表拼装 search 响应"""

    def try_assemble(self, cache_key: str) -> Optional[Dict[str, Any]]:
        """尝试拼装。成功返回 {"body": json字符串, "mode": 拼装模式}，
        无法可靠拼装时返回 None（调用方据此继续回源）。"""
        cond = parse_search_key(cache_key)
        if not cond:
            return None
        db = get_db_sync()
        try:
            if cond["kind"] == "episodes":
                return self._assemble_episodes(db, cond["title"], cond["episode"])
            return self._assemble_anime(db, cond["title"])
        except Exception as e:
            logger.warning(f"⚠️ 实体拼装失败（转回源）: {e}")
            return None
        finally:
            db.close()

    def _find_animes(self, db, title: str) -> List[ApiResponseEntity]:
        """按标题找 anime/bangumi 实体。

        先精确匹配；精确无果再前缀匹配（限 5 条，避免 '我' 这类短词扫全表）。
        不做 '%x%' 双侧模糊——用不上索引且误匹配率高。
        """
        rows = db.query(ApiResponseEntity).filter(
            ApiResponseEntity.entity_type.in_(("anime", "bangumi")),
            ApiResponseEntity.title == title,
        ).all()
        if rows:
            return rows
        if len(title) < 4:
            return []
        return db.query(ApiResponseEntity).filter(
            ApiResponseEntity.entity_type.in_(("anime", "bangumi")),
            ApiResponseEntity.title.like(f"{title}%"),
        ).limit(5).all()

    def _assemble_episodes(self, db, title: str,
                           ep_no: Optional[str]) -> Optional[Dict[str, Any]]:
        """拼装 /search/episodes 响应"""
        anime_rows = self._find_animes(db, title)
        if not anime_rows:
            return None
        animes: List[Dict[str, Any]] = []
        for a in anime_rows:
            eps = self._load_episodes(db, a.entity_id, ep_no)
            if not eps:
                continue
            # 整季查询要校验完整性，缺集则整体放弃拼装（宁可回源）
            if ep_no is None and not self._season_complete(db, a.entity_id, len(eps)):
                return None
            animes.append(self._build_anime_obj(a, eps))
        if not animes:
            return None
        body = {"hasMore": False, "animes": animes, "errorCode": 0, "success": True}
        return {
            "body": json.dumps(body, ensure_ascii=False),
            "mode": "episodes_single" if ep_no else "episodes_season",
        }

    def _load_episodes(self, db, anime_id: str,
                       ep_no: Optional[str]) -> List[ApiResponseEntity]:
        """取某番剧的集实体。ep_no 为 None 时取整季。"""
        q = db.query(ApiResponseEntity).filter(
            ApiResponseEntity.entity_type == "episode",
            ApiResponseEntity.anime_id == anime_id,
        )
        if ep_no is not None:
            return q.filter(ApiResponseEntity.episode_number == ep_no).all()
        rows = q.all()
        # 按集号数值排序；非数字集号（SP/OVA）排到末尾，保持顺序稳定
        def _sort_key(r):
            n = (r.episode_number or "").strip()
            return (0, int(n)) if n.isdigit() else (1, 0)
        return sorted(rows, key=_sort_key)

    def _season_complete(self, db, anime_id: str, have: int) -> bool:
        """整季完整性校验：实体集数需 >= media_library 声明的总集数。

        声明值缺失或为 0（连载中/上游未给）时判为不可靠，返回 False 走回源，
        避免把缺集的季当完整结果返回。
        """
        m = db.query(MediaLibrary).filter(MediaLibrary.anime_id == anime_id).first()
        declared = (m.episode_count if m else 0) or 0
        if declared <= 0:
            return False
        return have >= declared

    @staticmethod
    def _build_anime_obj(a: ApiResponseEntity,
                         eps: List[ApiResponseEntity]) -> Dict[str, Any]:
        """用 anime 实体的 raw_json 作底，挂上拼好的 episodes。

        以 raw_json 为底而非手工造字段：上游 anime 对象里的
        imageUrl/typeDescription/rating 等都原样保留，减少与真实响应的差异。
        """
        raw = a.raw_json if isinstance(a.raw_json, dict) else {}
        obj = dict(raw)
        obj.setdefault("animeId", _as_int(a.entity_id))
        obj.setdefault("animeTitle", a.title)
        obj["episodes"] = [
            (dict(e.raw_json) if isinstance(e.raw_json, dict) else {
                "episodeId": _as_int(e.entity_id),
                "episodeTitle": e.episode_title,
            })
            for e in eps
        ]
        return obj

    def _assemble_anime(self, db, keyword: str) -> Optional[Dict[str, Any]]:
        """拼装 /search/anime 响应。

        该接口不含集号维度，命中率本来就高（现网 52328 次命中 / 5258 条缓存），
        拼装只作为 miss 后的补充：按标题取 anime 实体，用 media_library 补全元数据。
        """
        anime_rows = self._find_animes(db, keyword)
        if not anime_rows:
            return None
        # 一次取齐媒体库主档，避免逐条查询
        ids = [a.entity_id for a in anime_rows]
        media = {
            m.anime_id: m
            for m in db.query(MediaLibrary).filter(MediaLibrary.anime_id.in_(ids)).all()
        }
        animes: List[Dict[str, Any]] = []
        for a in anime_rows:
            raw = a.raw_json if isinstance(a.raw_json, dict) else {}
            obj = dict(raw)
            obj.setdefault("animeId", _as_int(a.entity_id))
            obj.setdefault("animeTitle", a.title)
            m = media.get(a.entity_id)
            if m:
                # 实体 raw 缺字段时用媒体库补（bangumi 详情写入的元数据更全）
                if not obj.get("imageUrl") and m.image_url:
                    obj["imageUrl"] = m.image_url
                if not obj.get("type") and m.type_code:
                    obj["type"] = m.type_code
                if not obj.get("typeDescription") and m.type_desc:
                    obj["typeDescription"] = m.type_desc
                if not obj.get("episodeCount") and m.episode_count:
                    obj["episodeCount"] = m.episode_count
            # search/anime 的响应体不含 episodes 明细，剔除避免体积翻倍
            obj.pop("episodes", None)
            animes.append(obj)
        body = {"hasMore": False, "animes": animes, "errorCode": 0, "success": True}
        return {
            "body": json.dumps(body, ensure_ascii=False),
            "mode": "anime",
        }


def _as_int(v: Any) -> Any:
    """entity_id 存的是字符串，响应里 animeId/episodeId 是数字，转回去保持类型一致"""
    try:
        return int(v)
    except (TypeError, ValueError):
        return v


entity_assemble_service = EntityAssembleService()
