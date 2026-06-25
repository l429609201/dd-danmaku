"""
缓存服务 v2：处理 cache.upsert / cache.get

分工：
- 响应体（response_body）默认写 Redis，SQL 只保存 redis_key + 元数据；
- Redis 不可用时降级为 SQL 存储 body（storage_mode=sql）。
"""
import hashlib
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


class CacheService:
    """上游响应缓存服务"""

    def _redis_key(self, cache_key: str) -> str:
        return f"api:response:{_sha256(cache_key)}"

    async def upsert(self, record: Dict[str, Any]) -> bool:
        """Worker 200 响应写入本地缓存"""
        cache_key = record["cache_key"]
        body = record.get("body") or ""
        body_hash = record.get("body_hash") or f"sha256:{_sha256(body)}"
        body_size = len(body.encode("utf-8")) if body else 0
        redis_key = self._redis_key(cache_key)

        refresh_interval = settings.CACHE_REFRESH_INTERVAL_SECONDS
        stale_max_age = settings.CACHE_STALE_MAX_AGE_SECONDS
        current = now()

        # 1. body 优先写 Redis
        storage_mode = "sql"
        if settings.CACHE_BODY_STORAGE == "redis":
            ok = await redis_cache.set(redis_key, body, ttl=stale_max_age)
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
            # storage_mode=sql 时才把 body 落库，避免 Redis/SQL 双写
            row.response_body = body if storage_mode == "sql" else None
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

            # 读取 body：优先 Redis
            body = None
            if row.storage_mode == "redis" and row.redis_key:
                body = await redis_cache.get(row.redis_key)
            if body is None:
                body = row.response_body
            if body is None:
                if log_miss:
                    self._log(db, cache_key, row.api_path, "miss",
                              worker_request_id=worker_request_id,
                              client_ip=client_ip)
                return None

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


cache_service = CacheService()
