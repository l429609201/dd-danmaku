"""无法由 SchemaGuard 完成的列类型调整补丁。"""
import logging

from sqlalchemy import inspect
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)


def widen_cache_response_body(engine: Engine) -> bool:
    """MySQL 将缓存响应正文从 TEXT 扩为 MEDIUMTEXT。"""
    if engine.dialect.name != "mysql":
        return False
    inspector = inspect(engine)
    if "api_response_cache" not in set(inspector.get_table_names()):
        return False
    with engine.begin() as conn:
        row = conn.exec_driver_sql(
            "SELECT DATA_TYPE FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='api_response_cache' "
            "AND COLUMN_NAME='response_body'"
        ).fetchone()
        if not row or str(row[0]).lower() != "text":
            return False
        conn.exec_driver_sql(
            "ALTER TABLE `api_response_cache` "
            "MODIFY COLUMN `response_body` MEDIUMTEXT NULL")
    logger.info("📏 已扩宽 api_response_cache.response_body: TEXT → MEDIUMTEXT")
    return True


def widen_access_log_cache_key(engine: Engine) -> bool:
    """将访问日志缓存键扩到 2000，避免异常长搜索词连坐整批日志。"""
    table = "api_cache_access_logs"
    inspector = inspect(engine)
    if table not in set(inspector.get_table_names()) or engine.dialect.name == "sqlite":
        return False
    if engine.dialect.name == "mysql":
        with engine.begin() as conn:
            row = conn.exec_driver_sql(
                "SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS "
                f"WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='{table}' "
                "AND COLUMN_NAME='cache_key'"
            ).fetchone()
            if not row or row[0] is None or int(row[0]) >= 2000:
                return False
            conn.exec_driver_sql(
                f"ALTER TABLE `{table}` MODIFY COLUMN `cache_key` VARCHAR(2000) NOT NULL")
    else:
        column = next((item for item in inspector.get_columns(table)
                       if item["name"] == "cache_key"), None)
        length = getattr(column.get("type"), "length", None) if column else None
        if length is None or length >= 2000:
            return False
        with engine.begin() as conn:
            conn.exec_driver_sql(
                f'ALTER TABLE "{table}" ALTER COLUMN "cache_key" TYPE VARCHAR(2000)')
    logger.info("📏 已扩宽 %s.cache_key → varchar(2000)", table)
    return True
