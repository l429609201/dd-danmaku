"""
媒体库聚合服务（基于 media_library 主档表）

media_library 由 entity_service 从搜索/番剧响应抽取写入（含海报/类型/简介）。
本服务负责：按番剧聚合分页、关联集数链接与弹幕覆盖、缺失检测、海报代理。
"""
import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import case, func

from src.database import get_db_sync
from src.models_v2 import (
    ApiResponseCache, EpisodeLink, LocalCommentStore, MediaLibrary,
)

logger = logging.getLogger(__name__)


class MediaService:
    """媒体库聚合"""

    @staticmethod
    def _ep_sort_key(ep_number):
        """集号排序键：纯数字按数值排序（避免 "47" 排到 "470" 后面的字典序问题），
        非纯数字（OVA/SP 等）排到数字之后，按字符串排。
        返回 (组, 数值, 文本)：组 0=数字在前，组 1=其他在后。"""
        s = (ep_number or "").strip()
        try:
            # 支持 "12" 与 "12.5" 这类小数集号
            return (0, float(s), "")
        except (ValueError, TypeError):
            return (1, 0.0, s)

    def _danmaku_stats_bulk(self, db, anime_ids: List[str]) -> Dict[str, tuple]:
        """批量统计多番剧的 (链接集数, 有弹幕集数)，一条聚合 SQL 解决 N+1。

        EpisodeLink LEFT JOIN LocalCommentStore（episode_id 关联），
        按 dandan_anime_id 分组：
        - link_total = distinct episode 数
        - danmaku_cnt = comment_count>0 的 episode 数
        返回 { anime_id: (link_total, danmaku_cnt) }
        """
        if not anime_ids:
            return {}
        # 有弹幕标记：LocalCommentStore.comment_count > 0 记 1，否则 0
        has_dm = func.sum(
            case((LocalCommentStore.comment_count > 0, 1), else_=0)
        ).label("danmaku_cnt")
        rows = db.query(
            EpisodeLink.dandan_anime_id.label("aid"),
            func.count(func.distinct(EpisodeLink.dandan_episode_id)).label("link_total"),
            has_dm,
        ).outerjoin(
            LocalCommentStore,
            LocalCommentStore.episode_id == EpisodeLink.dandan_episode_id,
        ).filter(
            EpisodeLink.dandan_anime_id.in_(anime_ids)
        ).group_by(EpisodeLink.dandan_anime_id).all()
        return {r.aid: (int(r.link_total or 0), int(r.danmaku_cnt or 0)) for r in rows}

    def list_library(self, keyword: Optional[str] = None,
                     only_missing: bool = False,
                     page: int = 1, page_size: int = 12) -> Dict[str, Any]:
        """媒体库分页：以 media_library 为主档，关联弹幕覆盖与缺失。

        性能：弹幕统计改为批量聚合（一条 SQL），避免原先逐番剧 2 条 SQL 的 N+1。
        """
        db = get_db_sync()
        try:
            q = db.query(MediaLibrary)
            if keyword:
                q = q.filter(MediaLibrary.title.like(f"%{keyword}%"))
            medias = q.order_by(MediaLibrary.last_seen_at.desc()).all()

            # 批量取所有番剧的弹幕统计（一条聚合 SQL）
            stats = self._danmaku_stats_bulk(db, [m.anime_id for m in medias])

            items: List[Dict[str, Any]] = []
            for m in medias:
                link_total, danmaku_cnt = stats.get(m.anime_id, (0, 0))
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
                    # 海报直连上游图床（dandanplay 图床不防盗链，无需本地代理）
                    "image_proxy": m.image_url,
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
            for l in sorted(links, key=lambda x: self._ep_sort_key(x.episode_number)):
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
                # 海报直连上游图床，无需本地代理
                "image_proxy": (m.image_url if m else None),
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


media_service = MediaService()