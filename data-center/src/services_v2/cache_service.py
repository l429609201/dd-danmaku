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


# ============ 脏缓存扫描结果缓存（单进程内存，避免翻页重复全表扫描） ============
# uvicorn --workers 1，进程内缓存即可，无需跨进程同步。
# 结构：token -> {created_at, scanned, by_reason, samples:[全部脏条目明细]}
import time
import uuid

_DIRTY_SCAN_CACHE: Dict[str, Dict[str, Any]] = {}
_DIRTY_SCAN_TTL = 300          # 扫描结果保留 5 分钟
_DIRTY_SCAN_MAX_ENTRIES = 5    # 最多保留 5 份扫描结果，超出淘汰最旧


def _prune_dirty_scan_cache():
    """清理过期/超量的扫描结果，防内存堆积"""
    nowt = time.time()
    expired = [t for t, v in _DIRTY_SCAN_CACHE.items()
               if nowt - v["created_at"] > _DIRTY_SCAN_TTL]
    for t in expired:
        _DIRTY_SCAN_CACHE.pop(t, None)
    # 超量则淘汰最旧
    while len(_DIRTY_SCAN_CACHE) > _DIRTY_SCAN_MAX_ENTRIES:
        oldest = min(_DIRTY_SCAN_CACHE.items(), key=lambda kv: kv[1]["created_at"])[0]
        _DIRTY_SCAN_CACHE.pop(oldest, None)


def _paginate_samples(samples: list, page: int, page_size: int,
                      reason: Optional[str]) -> Dict[str, Any]:
    """从已缓存的全量明细中切片返回某页（纯内存，无 DB）"""
    import math
    page = max(1, page)
    page_size = max(1, min(page_size, 200))
    filtered = samples if not reason or reason == "all" \
        else [s for s in samples if s["reason"] == reason]
    total = len(filtered)
    total_pages = max(1, math.ceil(total / page_size)) if total else 1
    start = (page - 1) * page_size
    return {
        "samples": filtered[start:start + page_size],
        "page": page, "page_size": page_size,
        "total_pages": total_pages, "filtered_total": total,
    }


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

    async def purge_dirty(self, dry_run: bool = False,
                          api_path_prefix: Optional[str] = None,
                          older_than_days: int = 0,
                          reasons: Optional[list] = None,
                          batch_size: int = 2000,
                          collect_samples: bool = False) -> Dict[str, Any]:
        """扫描并清理脏缓存（success:false / 空结果 / errorCode!=0）。

        - dry_run=True 仅统计不删除（预览）
        - collect_samples=True 时一次性收集全部脏条目明细（供扫描结果缓存，翻页用）
        - api_path_prefix 只处理指定接口前缀
        - older_than_days>0 只处理 fetched_at 早于 N 天前的记录
        - reasons 指定脏类型白名单：['empty','fail','error_code']，None=全部
        - 游标分批扫描全表，避免大表 OOM
        返回 {scanned, deleted, dirty_total, by_reason, samples?}
        """
        from datetime import timedelta
        scanned = 0
        deleted = 0
        by_reason = {"empty": 0, "fail": 0, "error_code": 0}
        samples = []  # collect_samples=True 时收集全部脏条目明细
        reason_set = set(reasons) if reasons else None
        cutoff = now() - timedelta(days=older_than_days) if older_than_days > 0 else None

        last_id = 0
        while True:
            db = get_db_sync()
            try:
                q = db.query(ApiResponseCache).filter(ApiResponseCache.id > last_id)
                if api_path_prefix:
                    q = q.filter(ApiResponseCache.api_path.like(f"{api_path_prefix}%"))
                if cutoff is not None:
                    q = q.filter(ApiResponseCache.fetched_at < cutoff)
                rows = q.order_by(ApiResponseCache.id).limit(batch_size).all()
                if not rows:
                    break
                for row in rows:
                    last_id = row.id
                    scanned += 1
                    body = None
                    if row.storage_mode == "redis" and row.redis_key:
                        body = await redis_cache.get(row.redis_key)
                    if body is None:
                        body = row.response_body
                    reason = self._dirty_reason(row.api_path or "", body or "")
                    if reason is None:
                        continue  # 干净数据，跳过
                    # 脏类型白名单过滤
                    if reason_set is not None and reason not in reason_set:
                        continue
                    by_reason[reason] = by_reason.get(reason, 0) + 1
                    # 收集全部明细（仅扫描预览缓存用）
                    if collect_samples:
                        samples.append({
                            "id": row.id,
                            "cache_key": row.cache_key,
                            "api_path": row.api_path,
                            "reason": reason,
                            "status_code": row.status_code,
                            "storage_mode": row.storage_mode,
                            "body_size": row.body_size or 0,
                            "body_snippet": (body or "")[:200],
                            "fetched_at": row.fetched_at.isoformat() if row.fetched_at else None,
                        })
                    if not dry_run:
                        if row.redis_key:
                            await redis_cache.delete(row.redis_key)
                        db.delete(row)
                        deleted += 1
                if not dry_run:
                    db.commit()
                if len(rows) < batch_size:
                    break
            except Exception as e:
                db.rollback()
                logger.error(f"❌ 脏缓存清理失败: {e}")
                return {"scanned": scanned, "deleted": deleted,
                        "by_reason": by_reason, "samples": samples, "error": str(e)}
            finally:
                db.close()

        dirty_total = sum(by_reason.values())
        logger.info(f"🧹 脏缓存{'预览' if dry_run else '清理'}完成: "
                    f"扫描 {scanned} 脏数据 {dirty_total} 删除 {deleted}")
        return {"scanned": scanned, "dirty_total": dirty_total,
                "deleted": deleted, "by_reason": by_reason, "dry_run": dry_run,
                "samples": samples}

    async def scan_dirty(self, api_path_prefix: Optional[str] = None,
                         older_than_days: int = 0, reasons: Optional[list] = None,
                         page: int = 1, page_size: int = 20) -> Dict[str, Any]:
        """扫描脏缓存并缓存全量明细，返回首页切片 + scan_token（翻页用）。

        全表只扫一次，结果存进程内缓存（TTL 5 分钟），后续翻页走 get_dirty_page。
        """
        result = await self.purge_dirty(
            dry_run=True, api_path_prefix=api_path_prefix,
            older_than_days=older_than_days, reasons=reasons,
            collect_samples=True)
        if result.get("error"):
            return result
        all_samples = result["samples"]
        # 缓存全量明细
        _prune_dirty_scan_cache()
        token = uuid.uuid4().hex
        _DIRTY_SCAN_CACHE[token] = {
            "created_at": time.time(),
            "scanned": result["scanned"],
            "by_reason": result["by_reason"],
            "samples": all_samples,
        }
        page_data = _paginate_samples(all_samples, page, page_size, "all")
        return {
            "scan_token": token,
            "scanned": result["scanned"],
            "dirty_total": result["dirty_total"],
            "by_reason": result["by_reason"],
            "dry_run": True,
            **page_data,
        }

    def get_dirty_page(self, scan_token: str, page: int = 1,
                       page_size: int = 20, reason: Optional[str] = None) -> Dict[str, Any]:
        """从已缓存的扫描结果中取某页（纯内存切片，无 DB，毫秒级）。

        scan_token 失效（过期/重启）时返回 expired=True，前端需重新扫描。
        """
        _prune_dirty_scan_cache()
        entry = _DIRTY_SCAN_CACHE.get(scan_token)
        if not entry:
            return {"expired": True}
        page_data = _paginate_samples(entry["samples"], page, page_size, reason)
        return {
            "scan_token": scan_token,
            "scanned": entry["scanned"],
            "dirty_total": len(entry["samples"]),
            "by_reason": entry["by_reason"],
            "expired": False,
            **page_data,
        }

    @staticmethod
    def _dirty_reason(api_path: str, body: str) -> Optional[str]:
        """判定脏数据原因：empty/fail/error_code，干净返回 None。

        与 is_clean_cache_body 同源，但区分具体原因便于分组统计。
        """
        if not body:
            return "empty"
        try:
            data = json.loads(body)
        except Exception:
            return "empty"
        if not isinstance(data, dict):
            return "empty"
        if data.get("success") is False:
            return "fail"
        ec = data.get("errorCode")
        if isinstance(ec, int) and ec != 0:
            return "error_code"
        # 数据为空判定
        if "/search/anime" in api_path or "/search/episodes" in api_path:
            animes = data.get("animes")
            if not (isinstance(animes, list) and len(animes) > 0):
                return "empty"
        elif "/bangumi/" in api_path:
            bangumi = data.get("bangumi") or data
            if not (bangumi and (bangumi.get("animeId") or bangumi.get("animeTitle"))):
                return "empty"
        elif "/match" in api_path:
            matches = data.get("matches")
            if not (isinstance(matches, list) and len(matches) > 0):
                return "empty"
        return None


cache_service = CacheService()
