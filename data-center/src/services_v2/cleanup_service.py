"""
数据保留清理服务

第一版使用 asyncio 后台周期任务，避免额外引入 APScheduler。
只清理本地端 SQL 高频表；Worker R2 清理不在本服务范围内。
"""
import asyncio
import logging
from datetime import timedelta
from typing import Optional

from src.database import get_db_sync
from src.models_v2 import (
    ApiCacheAccessLog, ApiResponseCache, AppSetting,
    ControlMessage, RuntimeEvent,
)
from src.models_v2.base import now
from src.services_v2.redis_cache import redis_cache

logger = logging.getLogger(__name__)


class CleanupService:
    """本地端 SQL 数据保留清理任务"""

    def __init__(self):
        self._task: Optional[asyncio.Task] = None
        self._running = False

    async def start(self):
        """启动后台清理任务"""
        if self._task and not self._task.done():
            return
        self._running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info("✅ 数据保留清理任务已启动")

    async def stop(self):
        """停止后台清理任务"""
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None

    async def _run_loop(self):
        """按配置间隔循环清理；异常只记录，不影响主服务"""
        while self._running:
            interval = self._get_int("cleanup_interval_seconds", 3600)
            try:
                await self.cleanup_once()
            except Exception as e:
                logger.error(f"❌ 数据保留清理任务失败: {e}")
            await asyncio.sleep(max(60, interval))

    async def cleanup_once(self) -> dict:
        """执行一次清理，返回删除统计"""
        if not self._get_bool("cleanup_enabled", True):
            return {"enabled": False}

        current = now()
        result = {
            "api_cache_access_logs": self._delete_older_than(
                ApiCacheAccessLog, "created_at", current,
                self._get_int("cleanup_access_log_retention_days", 30),
            ),
            "control_messages": self._delete_older_than(
                ControlMessage, "created_at", current,
                self._get_int("cleanup_control_message_retention_days", 30),
            ),
            "runtime_events": self._delete_older_than(
                RuntimeEvent, "created_at", current,
                self._get_int("cleanup_runtime_event_retention_days", 30),
            ),
        }

        if self._get_bool("cleanup_expired_cache_enabled", False):
            result["expired_cache"] = await self._delete_expired_cache_shells(
                current, self._get_int("cleanup_expired_cache_retention_days", 90)
            )
        logger.info(f"🧹 数据保留清理完成: {result}")
        return result

    def _delete_older_than(self, model, field_name: str, current, days: int) -> int:
        """删除指定模型中早于保留期的数据"""
        if days <= 0:
            return 0
        cutoff = current - timedelta(days=days)
        db = get_db_sync()
        try:
            field = getattr(model, field_name)
            rows = db.query(model).filter(field < cutoff).all()
            count = len(rows)
            for row in rows:
                db.delete(row)
            db.commit()
            return count
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    async def _delete_expired_cache_shells(self, current, retention_days: int) -> int:
        """可选删除过期很久的响应缓存空壳，并顺带清 Redis key"""
        if retention_days <= 0:
            return 0
        cutoff = current - timedelta(days=retention_days)
        db = get_db_sync()
        try:
            rows = db.query(ApiResponseCache).filter(
                ApiResponseCache.expire_at < cutoff,
            ).limit(500).all()
            count = len(rows)
            for row in rows:
                if row.redis_key:
                    await redis_cache.delete(row.redis_key)
                db.delete(row)
            db.commit()
            return count
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def _get_setting(self, key: str) -> Optional[str]:
        db = get_db_sync()
        try:
            row = db.query(AppSetting).filter(AppSetting.key == key).first()
            return row.value if row else None
        finally:
            db.close()

    def _get_int(self, key: str, default: int) -> int:
        try:
            value = self._get_setting(key)
            return int(value) if value not in (None, "") else default
        except Exception:
            return default

    def _get_bool(self, key: str, default: bool) -> bool:
        value = self._get_setting(key)
        if value in (None, ""):
            return default
        return str(value).lower() in ("1", "true", "yes", "on")


cleanup_service = CleanupService()
