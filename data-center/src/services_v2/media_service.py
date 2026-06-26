"""
媒体库聚合服务（基于 media_library 主档表）

media_library 由 entity_service 从搜索/番剧响应抽取写入（含海报/类型/简介）。
本服务负责：按番剧聚合分页、关联集数链接与弹幕覆盖、缺失检测、海报代理。
"""
import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import func

from src.database import get_db_sync
from src.models_v2 import (
    ApiResponseCache, EpisodeLink, LocalCommentStore, MediaLibrary,
)

logger = logging.getLogger(__name__)


class MediaService:
    """媒体库聚合"""

    def _danmaku_stats(self, db, anime_id: str):
        """返回该番剧 (链接集数, 有弹幕集数)"""
        ep_ids = [r[0] for r in db.query(EpisodeLink.dandan_episode_id).filter(
            EpisodeLink.dandan_anime_id == anime_id).all()]
        link_total = len(ep_ids)
        danmaku_cnt = 0
        if ep_ids:
            danmaku_cnt = db.query(func.count(LocalCommentStore.id)).filter(
                LocalCommentStore.episode_id.in_(ep_ids),
                LocalCommentStore.comment_count > 0,
            ).scalar() or 0
        return link_total, danmaku_cnt

    def list_library(self, keyword: Optional[str] = None,
                     only_missing: bool = False,
                     page: int = 1, page_size: int = 12) -> Dict[str, Any]:
        """媒体库分页：以 media_library 为主档，关联弹幕覆盖与缺失"""
        db = get_db_sync()
        try:
            q = db.query(MediaLibrary)
            if keyword:
                q = q.filter(MediaLibrary.title.like(f"%{keyword}%"))
            medias = q.order_by(MediaLibrary.last_seen_at.desc()).all()

            items: List[Dict[str, Any]] = []
            for m in medias:
                link_total, danmaku_cnt = self._danmaku_stats(db, m.anime_id)
                # 总集数：优先上游声明，回退已建链接数
                ep_total = m.episode_count or link_total
                missing = max(0, ep_total - danmaku_cnt)
                ratio = round(danmaku_cnt / ep_total * 100, 1) if ep_total else 0.0
                if only_missing and missing <= 0:
                    continue
                items.append({
                    "anime_id": m.anime_id,
                    "title": m.title or "未知番剧",
                    "ep_total": ep_total,
                    "link_total": link_total,
                    "danmaku_count": danmaku_cnt,
                    "missing_danmaku": missing,
                    "danmaku_ratio": ratio,
                    "image_proxy": self.proxy_url(m.image_url),
                    "type_desc": m.type_desc,
                    "rating": m.rating,
                    "last_seen_at": m.last_seen_at.isoformat() if m.last_seen_at else None,
                })
            items.sort(key=lambda x: (x["missing_danmaku"], x["ep_total"]), reverse=True)
            total = len(items)
            start = (page - 1) * page_size
            return {"total": total, "items": items[start:start + page_size]}
        finally:
            db.close()

    def get_detail(self, anime_id: str) -> Optional[Dict[str, Any]]:
        """番剧详情：媒体元信息 + 每集弹幕/链接状态"""
        db = get_db_sync()
        try:
            m = db.query(MediaLibrary).filter(
                MediaLibrary.anime_id == anime_id).first()
            links = db.query(EpisodeLink).filter(
                EpisodeLink.dandan_anime_id == anime_id).all()
            if not m and not links:
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
                })
            danmaku_cnt = sum(1 for e in episodes if e["has_danmaku"])
            ep_total = (m.episode_count if m else 0) or len(episodes)
            title = (m.title if m else None) or (links[0].anime_title if links else "未知番剧")
            return {
                "anime_id": anime_id, "title": title,
                "ep_total": ep_total,
                "link_total": len(episodes),
                "danmaku_count": danmaku_cnt,
                "missing_danmaku": max(0, ep_total - danmaku_cnt),
                "image_proxy": self.proxy_url(m.image_url if m else None),
                "type_desc": m.type_desc if m else None,
                "summary": m.summary if m else None,
                "rating": m.rating if m else None,
                "start_date": m.start_date if m else None,
                "episodes": episodes,
            }
        finally:
            db.close()

    def get_image_url(self, anime_id: str) -> Optional[str]:
        """取番剧原始海报 URL（供代理回源用）"""
        db = get_db_sync()
        try:
            m = db.query(MediaLibrary).filter(
                MediaLibrary.anime_id == anime_id).first()
            return m.image_url if m else None
        finally:
            db.close()

    async def rebuild_from_cache(self, limit: int = 0) -> Dict[str, Any]:
        """从已存储的响应缓存批量回填媒体库与实体索引。

        遍历 api_response_cache 中的 search/anime、search/episodes、bangumi 响应，
        取 body（优先 Redis，回退 SQL）重新调用实体解析，补全历史数据。
        limit=0 表示处理全部。返回 {scanned, parsed}。
        """
        from src.services_v2.redis_cache import redis_cache
        from src.services_v2.entity_service import entity_index_service
        scanned = 0
        parsed = 0
        last_id = 0
        batch = 500
        stop = False
        while not stop:
            db = get_db_sync()
            try:
                q = db.query(ApiResponseCache).filter(
                    ApiResponseCache.id > last_id,
                    ApiResponseCache.api_path.like("%/api/v2/%"),
                )
                rows = q.order_by(ApiResponseCache.id).limit(batch).all()
                if len(rows) < batch:
                    stop = True  # 本批不足说明已到末尾
                # 先把本批数据取出，避免会话跨 await
                pending = []
                for row in rows:
                    last_id = row.id
                    ap = row.api_path or ""
                    # 仅处理含媒体信息的接口
                    if not ("/search/anime" in ap or "/search/episodes" in ap or "/bangumi/" in ap):
                        continue
                    pending.append((ap, row.cache_key, row.redis_key,
                                    row.storage_mode, row.response_body))
            finally:
                db.close()

            for ap, cache_key, redis_key, storage, sql_body in pending:
                scanned += 1
                body = None
                if storage == "redis" and redis_key:
                    body = await redis_cache.get(redis_key)
                if body is None:
                    body = sql_body
                if not body:
                    continue
                try:
                    # 复用实体解析：同时写 api_response_entities 与 media_library
                    entity_index_service.index_from_response(ap, cache_key, body)
                    parsed += 1
                except Exception as e:
                    logger.warning(f"⚠️ 媒体库回填解析失败 {cache_key}: {e}")
                if limit and scanned >= limit:
                    stop = True
                    break
        logger.info(f"🎬 媒体库回填完成: 扫描 {scanned} 解析 {parsed}")
        return {"scanned": scanned, "parsed": parsed}

    @staticmethod
    def proxy_url(image_url: Optional[str]) -> Optional[str]:
        """把上游海报转成本地代理路径，绕开防盗链。前端用此地址显示。"""
        if not image_url:
            return None
        from urllib.parse import quote
        return f"/api/v2/media/poster?url={quote(image_url, safe='')}"


media_service = MediaService()