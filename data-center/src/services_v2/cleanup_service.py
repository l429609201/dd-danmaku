"""
数据保留清理服务（可配置版）

后台周期任务，按 cleanup_policy 表配置驱动清理本地端 SQL 高频表。
表清单见 TABLE_REGISTRY；前端可勾选启用/调保留天数。
"""
import asyncio
import logging
from datetime import timedelta
from typing import Optional

from sqlalchemy import inspect

from src.database import get_db_sync
from src.models_v2 import (
    ApiCacheAccessLog, ApiResponseCache, AppSetting,
    ControlMessage, RuntimeEvent, WorkerRequestLog, WorkerMetricsSnapshot,
    IpRequestStatSnapshot, IpRequestStatCurrent, ApiCacheRefreshTask,
    CleanupPolicy,
)
from src.models_v2.base import now
from src.services_v2.redis_cache import redis_cache

logger = logging.getLogger(__name__)


# 可清理表注册表：table_key -> (模型, 时间字段, 中文名, 是否安全, 仅清空壳)
# is_safe=False 的为业务敏感表，前端默认关闭并红色警示
TABLE_REGISTRY = {
    "api_cache_access_logs": (ApiCacheAccessLog, "created_at", "缓存访问日志", True, False),
    "control_messages": (ControlMessage, "created_at", "长连接消息审计", True, False),
    "runtime_events": (RuntimeEvent, "created_at", "运行事件日志", True, False),
    "worker_request_logs": (WorkerRequestLog, "created_at", "Worker 请求日志", True, False),
    "worker_metrics_snapshot": (WorkerMetricsSnapshot, "snapshot_at", "Worker 指标快照", True, False),
    "ip_request_stats_snapshot": (IpRequestStatSnapshot, "snapshot_at", "IP 统计快照", True, False),
    "api_cache_refresh_task": (ApiCacheRefreshTask, "created_at", "已完成的刷新任务", True, False),
    # 敏感表：默认关闭
    "api_response_cache": (ApiResponseCache, "expire_at", "响应缓存(仅过期空壳)", False, True),
    "ip_request_stats_current": (IpRequestStatCurrent, "updated_at", "IP 当前累计统计", False, False),
}

# 默认策略：table_key -> (默认启用, 默认保留天数)
DEFAULT_POLICY = {
    "api_cache_access_logs": (True, 30),
    "control_messages": (True, 30),
    "runtime_events": (True, 30),
    "worker_request_logs": (True, 7),
    "worker_metrics_snapshot": (True, 30),
    "ip_request_stats_snapshot": (True, 7),
    "api_cache_refresh_task": (True, 14),
    "api_response_cache": (False, 90),
    "ip_request_stats_current": (False, 30),
}


class CleanupService:
    """本地端 SQL 数据保留清理任务"""

    def __init__(self):
        self._task: Optional[asyncio.Task] = None
        self._running = False

    async def start(self):
        """启动后台清理任务"""
        if self._task and not self._task.done():
            return
        self.ensure_default_policies()
        self._running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info("✅ 数据保留清理任务已启动")

    def ensure_default_policies(self):
        """确保每个可清理表都有一条策略；缺失则按默认值创建"""
        db = get_db_sync()
        try:
            existing = {p.table_key for p in db.query(CleanupPolicy).all()}
            for key, reg in TABLE_REGISTRY.items():
                if key in existing:
                    continue
                _model, _tf, name, is_safe, expired_only = reg
                en, days = DEFAULT_POLICY.get(key, (False, 30))
                db.add(CleanupPolicy(
                    table_key=key, display_name=name, enabled=en,
                    retention_days=days, is_safe=is_safe, expired_only=expired_only,
                ))
            db.commit()
        except Exception as e:
            db.rollback()
            logger.warning(f"⚠️ 初始化清理策略失败: {e}")
        finally:
            db.close()

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

    async def cleanup_once(self, only_keys: Optional[list] = None) -> dict:
        """执行一次清理，按 cleanup_policy 配置驱动。
        only_keys 指定时只清这些表（手动触发用），否则清所有 enabled 的表"""
        if not self._get_bool("cleanup_enabled", True):
            return {"enabled": False}

        current = now()
        db = get_db_sync()
        try:
            policies = db.query(CleanupPolicy).all()
        finally:
            db.close()

        result = {}
        for p in policies:
            if p.table_key not in TABLE_REGISTRY:
                continue
            if only_keys is not None and p.table_key not in only_keys:
                continue
            # 手动指定时忽略 enabled，否则只清启用的
            if only_keys is None and not p.enabled:
                continue
            model, time_field, _name, _safe, expired_only = TABLE_REGISTRY[p.table_key]
            try:
                if expired_only:
                    # 特殊模式：仅清过期空壳（如 api_response_cache）
                    deleted = await self._delete_expired_cache_shells(
                        current, p.retention_days)
                else:
                    deleted = self._delete_older_than(
                        model, time_field, current, p.retention_days)
                result[p.table_key] = deleted
                self._mark_policy_done(p.table_key, deleted)
            except Exception as e:
                logger.error(f"❌ 清理 {p.table_key} 失败: {e}")
                result[p.table_key] = f"error: {e}"

        logger.info(f"🧹 数据保留清理完成: {result}")
        return result

    def _mark_policy_done(self, table_key: str, deleted: int):
        """记录单表清理结果（最后清理时间/删除行数）"""
        db = get_db_sync()
        try:
            p = db.query(CleanupPolicy).filter(
                CleanupPolicy.table_key == table_key).first()
            if p:
                p.last_cleanup_at = now()
                p.last_deleted = deleted
                db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()

    def _delete_older_than(self, model, field_name: str, current, days: int) -> int:
        """删除早于保留期的数据：分批 SQL DELETE，避免百万行 load 进内存导致 OOM"""
        if days <= 0:
            return 0
        cutoff = current - timedelta(days=days)
        field = getattr(model, field_name)
        total = 0
        batch = 5000
        # 循环分批删除，每批提交，直到没有更多过期行
        while True:
            db = get_db_sync()
            try:
                # 子查询取一批主键，再按主键删除（兼容 MySQL/SQLite/PG）
                pk = inspect(model).primary_key[0]
                ids = [r[0] for r in db.query(pk).filter(field < cutoff)
                       .limit(batch).all()]
                if not ids:
                    break
                deleted = db.query(model).filter(pk.in_(ids)) \
                    .delete(synchronize_session=False)
                db.commit()
                total += deleted
                if deleted < batch:
                    break
            except Exception:
                db.rollback()
                raise
            finally:
                db.close()
        return total

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
