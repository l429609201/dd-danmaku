"""配置策略迁移补丁。"""
import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)


def access_log_retention_14d(engine: Engine) -> bool:
    """仅把仍为旧默认 30 天的缓存访问日志策略迁移到 14 天。"""
    tables = set(inspect(engine).get_table_names())
    if "cleanup_policy" not in tables:
        return False
    with engine.begin() as conn:
        result = conn.execute(text(
            "UPDATE cleanup_policy SET retention_days=14, "
            "updated_at=CURRENT_TIMESTAMP "
            "WHERE table_key='api_cache_access_logs' AND retention_days=30"
        ))
    changed = bool(result.rowcount)
    logger.info(
        "🧹 缓存访问日志保留期迁移: %s",
        "30天 → 14天" if changed else "保留用户现有配置",
    )
    return changed
