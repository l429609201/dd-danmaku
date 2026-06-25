"""
媒体库聚合服务

以 episode_links 为核心，按 dandan_anime_id 聚合成"番剧"维度视图，
关联 local_comment_store（弹幕覆盖）与 api_response_entities（封面/简介），
并检测缺失情况（哪些集没弹幕、没链接），供媒体库页面展示与补全。
"""
import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import func

from src.database import get_db_sync
from src.models_v2 import ApiResponseEntity, EpisodeLink, LocalCommentStore

logger = logging.getLogger(__name__)


def _extract_cover_summary(raw: Any) -> Dict[str, Any]:
    """从 bangumi 实体 raw_json 提取封面/简介/评分等媒体元数据"""
    if not isinstance(raw, dict):
        return {}
    return {
        "image_url": raw.get("imageUrl") or None,
        "summary": raw.get("summary") or None,
        "type_desc": raw.get("typeDescription") or raw.get("type") or None,
        "rating": raw.get("rating") or raw.get("ratingDetails") or None,
        "air_date": raw.get("airDate") or None,
    }


class MediaService:
    """媒体库聚合"""

    def _anime_meta(self, db, anime_id: str) -> Dict[str, Any]:
        """取该 anime 的 bangumi 实体元数据（封面/简介）"""
        ent = db.query(ApiResponseEntity).filter(
            ApiResponseEntity.entity_type == "bangumi",
            ApiResponseEntity.entity_id == anime_id,
        ).first()
        if not ent:
            return {}
        return _extract_cover_summary(ent.raw_json)

    def list_library(self, keyword: Optional[str] = None,
                     only_missing: bool = False,
                     page: int = 1, page_size: int = 12) -> Dict[str, Any]:
        """按番剧聚合分页。only_missing=True 仅返回存在缺失(弹幕/链接)的番剧"""
        db = get_db_sync()
        try:
            # 按 anime_id 聚合：集数、动画名、最近使用
            base = db.query(
                EpisodeLink.dandan_anime_id.label("anime_id"),
                func.max(EpisodeLink.anime_title).label("title"),
                func.count(EpisodeLink.id).label("ep_count"),
                func.max(EpisodeLink.last_used_at).label("last_used"),
            ).filter(EpisodeLink.dandan_anime_id.isnot(None))
            if keyword:
                base = base.filter(EpisodeLink.anime_title.like(f"%{keyword}%"))
            base = base.group_by(EpisodeLink.dandan_anime_id)
            groups = base.all()

            items: List[Dict[str, Any]] = []
            for g in groups:
                anime_id = g.anime_id
                # 该番剧所有集的 episodeId
                ep_ids = [r[0] for r in db.query(EpisodeLink.dandan_episode_id).filter(
                    EpisodeLink.dandan_anime_id == anime_id).all()]
                ep_total = len(ep_ids)
                # 弹幕覆盖：local_comment_store 中存在且条数 > 0 的集
                danmaku_cnt = 0
                if ep_ids:
                    danmaku_cnt = db.query(func.count(LocalCommentStore.id)).filter(
                        LocalCommentStore.episode_id.in_(ep_ids),
                        LocalCommentStore.comment_count > 0,
                    ).scalar() or 0
                missing_danmaku = ep_total - danmaku_cnt
                meta = self._anime_meta(db, anime_id) if anime_id else {}
                ratio = round(danmaku_cnt / ep_total * 100, 1) if ep_total else 0.0
                if only_missing and missing_danmaku <= 0:
                    continue
                items.append({
                    "anime_id": anime_id,
                    "title": g.title or "未知番剧",
                    "ep_total": ep_total,
                    "danmaku_count": danmaku_cnt,
                    "missing_danmaku": missing_danmaku,
                    "danmaku_ratio": ratio,
                    "image_url": meta.get("image_url"),
                    "type_desc": meta.get("type_desc"),
                    "last_used_at": g.last_used.isoformat() if g.last_used else None,
                })
            # 内存分页（番剧数量级可控）
            items.sort(key=lambda x: (x["missing_danmaku"], x["ep_total"]), reverse=True)
            total = len(items)
            start = (page - 1) * page_size
            return {"total": total, "items": items[start:start + page_size]}
        finally:
            db.close()

    def get_detail(self, anime_id: str) -> Optional[Dict[str, Any]]:
        """番剧详情：每集状态（是否有弹幕/弹幕条数）+ 元数据"""
        db = get_db_sync()
        try:
            links = db.query(EpisodeLink).filter(
                EpisodeLink.dandan_anime_id == anime_id).all()
            if not links:
                return None
            ep_ids = [l.dandan_episode_id for l in links]
            store_map = {}
            if ep_ids:
                for s in db.query(LocalCommentStore).filter(
                        LocalCommentStore.episode_id.in_(ep_ids)).all():
                    store_map[s.episode_id] = s.comment_count or 0
            episodes = []
            for l in sorted(links, key=lambda x: (x.episode_number or "")):
                cnt = store_map.get(l.dandan_episode_id, 0)
                episodes.append({
                    "episode_id": l.dandan_episode_id,
                    "episode_number": l.episode_number,
                    "episode_title": l.episode_title,
                    "has_danmaku": cnt > 0,
                    "comment_count": cnt,
                    "is_manual": l.is_manual,
                    "confidence": l.confidence,
                })
            meta = self._anime_meta(db, anime_id)
            title = links[0].anime_title or "未知番剧"
            danmaku_cnt = sum(1 for e in episodes if e["has_danmaku"])
            return {
                "anime_id": anime_id, "title": title,
                "ep_total": len(episodes),
                "danmaku_count": danmaku_cnt,
                "missing_danmaku": len(episodes) - danmaku_cnt,
                "meta": meta,
                "episodes": episodes,
            }
        finally:
            db.close()


media_service = MediaService()
