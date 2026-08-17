"""实体表约束补丁。"""
import logging

from sqlalchemy import inspect
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)


def add_entity_unique_key(engine: Engine) -> bool:
    """去重后建立 (entity_type, entity_id) 唯一索引。

    该补丁会删除重复行，因此在注册表中标记为不可逆。
    """
    table = "api_response_entities"
    columns = ("entity_type", "entity_id")
    inspector = inspect(engine)
    if table not in set(inspector.get_table_names()):
        return False
    indexes = inspector.get_indexes(table)
    if any(tuple(index.get("column_names") or []) == columns and index.get("unique")
           for index in indexes):
        return False
    table_columns = {item["name"] for item in inspector.get_columns(table)}
    if not set(columns).issubset(table_columns):
        return False
    with engine.begin() as conn:
        result = conn.exec_driver_sql(
            f"DELETE FROM {table} WHERE id NOT IN (SELECT keep_id FROM ("
            f"SELECT MIN(id) keep_id FROM {table} GROUP BY entity_type, entity_id) t)")
        removed = result.rowcount or 0
        if engine.dialect.name == "mysql":
            conn.exec_driver_sql(
                f"CREATE UNIQUE INDEX `uq_are_type_id` ON `{table}` "
                "(`entity_type`, `entity_id`)")
        else:
            conn.exec_driver_sql(
                f'CREATE UNIQUE INDEX IF NOT EXISTS "uq_are_type_id" ON "{table}" '
                '("entity_type", "entity_id")')
    logger.info("🔑 已创建实体唯一约束，去重 %d 行", removed)
    return True
