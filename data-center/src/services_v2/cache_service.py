"""
缓存服务 v2：处理 cache.upsert / cache.get

分工：
- 响应体（response_body）默认写 Redis，SQL 只保存 redis_key + 元数据；
- Redis 不可用时降级为 SQL 存储 body（storage_mode=sql）。
"""
import hashlib
import json
import logging
from datetime import timedelta
from typing import Any, Dict, Optional

from src.config import settings
from src.database import get_db_sync
from src.models_v2 import ApiResponseCache, ApiCacheAccessLog
from src.models_v2.base import now
from src.services_v2.redis_cache import redis_cache

logger = logging.getLogger(__name__)


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def is_clean_cache_body(api_path: str, body: str) -> bool:
    """校验响应体是否「干净可缓存」（与 Worker 侧 isCacheableResponseBody 对齐）。

    挡掉 success:false / errorCode!=0 / 空结果，作为脏数据落库的双保险。
    """
    if not body:
        return False
    try:
        data = json.loads(body)
    except Exception:
        return False
    if not isinstance(data, dict):
        return False
    if data.get("success") is False:
        return False
    ec = data.get("errorCode")
    if isinstance(ec, int) and ec != 0:
        return False
    if "/search/anime" in api_path or "/search/episodes" in api_path:
        animes = data.get("animes")
        return isinstance(animes, list) and len(animes) > 0
    if "/bangumi/" in api_path:
        bangumi = data.get("bangumi") or data
        return bool(bangumi and (bangumi.get("animeId") or bangumi.get("animeTitle")))
    if "/match" in api_path:
        matches = data.get("matches")
        return isinstance(matches, list) and len(matches) > 0
    return True


class CacheService:
    """上游响应缓存服务"""

    def _redis_key(self, cache_key: str) -> str:
        return f"api:response:{_sha256(cache_key)}"

    async def upsert(self, record: Dict[str, Any]) -> bool:
        """Worker 200 响应写入本地缓存"""
        cache_key = record["cache_key"]
        body = record.get("body") or ""
        api_path = record.get("api_path", "")
        # 双保险：脏响应（空结果/success:false/errorCode!=0）拒绝落库
        if not is_clean_cache_body(api_path, body):
            logger.info(f"🧹 拒绝缓存脏响应: {api_path} (cache_key={cache_key})")
            return False
        body_hash = record.get("body_hash") or f"sha256:{_sha256(body)}"
        body_size = len(body.encode("utf-8")) if body else 0
        redis_key = self._redis_key(cache_key)

        refresh_interval = settings.CACHE_REFRESH_INTERVAL_SECONDS
        stale_max_age = settings.CACHE_STALE_MAX_AGE_SECONDS
        current = now()

        # 1. body 优先写 Redis（主缓存，用于快速响应）
        storage_mode = "sql"
        if settings.CACHE_BODY_STORAGE == "redis":
            ok = await redis_cache.set(redis_key, body, ttl=stale_max_age)
            # 双写：Redis 写成功也标记为 redis（读时优先 Redis）；
            # 但 SQL 始终保留 body 作为冷备，Redis 重启/淘汰后可回填
            storage_mode = "redis" if ok else "sql"

        db = get_db_sync()
        try:
            row = db.query(ApiResponseCache).filter(
                ApiResponseCache.cache_key == cache_key
            ).first()
            if not row:
                row = ApiResponseCache(cache_key=cache_key)
                db.add(row)

            row.source = record.get("source", "dandanplay")
            row.method = record.get("method", "GET")
            row.api_path = record.get("api_path", "")
            row.normalized_query = record.get("normalized_query")
            row.query_json = record.get("query")
            row.request_body_hash = record.get("request_body_hash")
            # 记录写入缓存的客户端 IP（明文，便于直接排查来源）
            row.client_ip = (record.get("client_ip") or None)
            row.status_code = record.get("status", 200)
            row.response_headers_json = record.get("headers")
            row.redis_key = redis_key
            row.storage_mode = storage_mode
            # 双写：SQL 始终保存 body 作为冷备（即使 storage_mode=redis）。
            # Redis 重启/淘汰丢 key 后，get 可从 SQL 回填 Redis，避免缓存变空壳。
            row.response_body = body
            row.body_hash = body_hash
            row.body_size = body_size
            row.fetched_at = current
            row.last_refresh_at = current
            row.refresh_after = current + timedelta(seconds=refresh_interval)
            row.expire_at = current + timedelta(seconds=stale_max_age)
            row.refresh_pending = False
            db.commit()

            self._log(db, cache_key, row.api_path, "upsert",
                      upstream_status=row.status_code,
                      client_ip=row.client_ip)
            return True
        except Exception as e:
            logger.error(f"❌ cache.upsert 失败: {e}")
            db.rollback()
            return False
        finally:
            db.close()

    async def get(self, cache_key: str,
                  worker_request_id: Optional[str] = None,
                  client_ip: Optional[str] = None,
                  log_miss: bool = True) -> Optional[Dict[str, Any]]:
        """读取本地缓存。log_miss=False 时不写 miss/expired 访问日志
        （主动预查场景调用频繁，避免 access_logs 暴涨）"""
        client_ip = (client_ip or None)
        db = get_db_sync()
        try:
            row = db.query(ApiResponseCache).filter(
                ApiResponseCache.cache_key == cache_key
            ).first()
            if not row:
                if log_miss:
                    self._log(db, cache_key, "", "miss",
                              worker_request_id=worker_request_id,
                              client_ip=client_ip)
                return None

            current = now()
            # 超过 expire_at 不再兜底
            if row.expire_at and current > row.expire_at:
                if log_miss:
                    self._log(db, cache_key, row.api_path, "expired",
                              worker_request_id=worker_request_id,
                              client_ip=client_ip)
                return None

            # 读取 body：优先 Redis（主缓存，快路径）
            body = None
            redis_hit = False
            if row.storage_mode == "redis" and row.redis_key:
                body = await redis_cache.get(row.redis_key)
                redis_hit = body is not None
            # Redis 未命中（重启/淘汰）→ 回退 SQL 冷备
            if body is None:
                body = row.response_body
            if body is None:
                if log_miss:
                    self._log(db, cache_key, row.api_path, "miss",
                              worker_request_id=worker_request_id,
                              client_ip=client_ip)
                return None

            # 关键：Redis 没命中但 SQL 有 body → 回写 Redis 预热，
            # 下次别人调用即可走 Redis 快路径（实现 Redis 自愈）
            if not redis_hit and row.redis_key and settings.CACHE_BODY_STORAGE == "redis":
                ttl = settings.CACHE_STALE_MAX_AGE_SECONDS
                await redis_cache.set(row.redis_key, body, ttl=ttl)
                if row.storage_mode != "redis":
                    row.storage_mode = "redis"

            # 判断是否 stale，stale 则标记待刷新
            stale = bool(row.refresh_after and current > row.refresh_after)
            row.hit_count = (row.hit_count or 0) + 1
            row.last_used_at = current
            if stale:
                row.refresh_pending = True
                row.stale_hit_count = (row.stale_hit_count or 0) + 1
            db.commit()

            self._log(db, cache_key, row.api_path,
                      "stale_hit" if stale else "hit",
                      served_status=row.status_code,
                      worker_request_id=worker_request_id,
                      client_ip=client_ip)
            return {
                "hit": True,
                "status": row.status_code,
                "headers": row.response_headers_json or {},
                "body": body,
                "cached_at": int(row.fetched_at.timestamp() * 1000) if row.fetched_at else 0,
                "stale": stale,
            }
        except Exception as e:
            logger.error(f"❌ cache.get 失败: {e}")
            return None
        finally:
            db.close()

    def _log(self, db, cache_key, api_path, access_type,
             upstream_status=None, served_status=None, worker_request_id=None,
             client_ip=None):
        """写访问日志，失败不影响主流程"""
        try:
            db.add(ApiCacheAccessLog(
                cache_key=cache_key, api_path=api_path or "",
                access_type=access_type, upstream_status=upstream_status,
                served_status=served_status, worker_request_id=worker_request_id,
                client_ip=client_ip,
            ))
            db.commit()
        except Exception:
            db.rollback()

    async def purge_dirty(self, limit: int = 2000) -> Dict[str, int]:
        """扫描并清理脏缓存：success:false / 空结果 / errorCode!=0 的历史响应缓存。

        逐条取 body（优先 Redis，回退 SQL）用 is_clean_cache_body 判定，
        命中即删除 SQL 行 + Redis key。返回 {scanned, deleted}。
        """
        scanned = 0
        deleted = 0
        db = get_db_sync()
        try:
            rows = db.query(ApiResponseCache).limit(limit).all()
            for row in rows:
                scanned += 1
                body = None
                if row.storage_mode == "redis" and row.redis_key:
                    body = await redis_cache.get(row.redis_key)
                if body is None:
                    body = row.response_body
                # body 拿不到或为脏数据 → 删除
                if not is_clean_cache_body(row.api_path or "", body or ""):
                    if row.redis_key:
                        await redis_cache.delete(row.redis_key)
                    db.delete(row)
                    deleted += 1
            db.commit()
            logger.info(f"🧹 脏缓存清理完成: 扫描 {scanned} 删除 {deleted}")
            return {"scanned": scanned, "deleted": deleted}
        except Exception as e:
            db.rollback()
            logger.error(f"❌ 脏缓存清理失败: {e}")
            return {"scanned": scanned, "deleted": deleted, "error": str(e)}
        finally:
            db.close()


cache_service = CacheService()
