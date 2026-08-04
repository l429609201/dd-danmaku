"""存量数据回填补丁。"""
import logging

from sqlalchemy import inspect
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)


def backfill_entity_anime_episode(engine: Engine) -> bool:
    """回填 episode 实体的 anime_id 与 episode_number。"""
    table = "api_response_entities"
    inspector = inspect(engine)
    if table not in set(inspector.get_table_names()):
        return False
    columns = {item["name"] for item in inspector.get_columns(table)}
    if not {"anime_id", "episode_number"}.issubset(columns):
        return False
    dialect = engine.dialect.name
    if dialect == "mysql":
        json_expr = "JSON_UNQUOTE(JSON_EXTRACT(raw_json, '$.episodeNumber'))"
    elif dialect == "sqlite":
        json_expr = "json_extract(raw_json, '$.episodeNumber')"
    else:
        return False
    with engine.connect() as conn:
        pending = conn.exec_driver_sql(
            f"SELECT COUNT(*) FROM {table} WHERE entity_type='episode' "
            "AND (anime_id IS NULL OR episode_number IS NULL)"
        ).scalar() or 0
    if not pending:
        return False
    logger.info("🔄 开始回填 %s（待处理 %d 行）", table, pending)
    with engine.begin() as conn:
        conn.exec_driver_sql(
            f"UPDATE {table} SET episode_number={json_expr} "
            "WHERE entity_type='episode' AND episode_number IS NULL "
            f"AND {json_expr} IS NOT NULL")
    with engine.begin() as conn:
        if dialect == "mysql":
            conn.exec_driver_sql(
                f"UPDATE {table} e JOIN (SELECT title, MIN(entity_id) aid FROM {table} "
                "WHERE entity_type IN ('anime','bangumi') AND title IS NOT NULL "
                "GROUP BY title) m ON e.title=m.title SET e.anime_id=m.aid "
                "WHERE e.entity_type='episode' AND e.anime_id IS NULL")
        else:
            conn.exec_driver_sql(
                f"UPDATE {table} SET anime_id=(SELECT MIN(a.entity_id) FROM {table} a "
                f"WHERE a.entity_type IN ('anime','bangumi') AND a.title={table}.title) "
                "WHERE entity_type='episode' AND anime_id IS NULL")
    return True


def backfill_alias_norm_ns(engine: Engine) -> bool:
    """回填别名去空白标准化列。"""
    table = "media_alias"
    inspector = inspect(engine)
    if table not in set(inspector.get_table_names()):
        return False
    columns = {item["name"] for item in inspector.get_columns(table)}
    if not {"alias_norm", "alias_norm_ns"}.issubset(columns):
        return False
    with engine.begin() as conn:
        pending = conn.exec_driver_sql(
            f"SELECT COUNT(*) FROM {table} WHERE alias_norm_ns IS NULL").scalar() or 0
        if not pending:
            return False
        conn.exec_driver_sql(
            f"UPDATE {table} SET alias_norm_ns=REPLACE(REPLACE(REPLACE("
            "alias_norm, ' ', ''), CHAR(9), ''), CHAR(10), '') "
            "WHERE alias_norm_ns IS NULL")
    logger.info("🔤 已回填 %s.alias_norm_ns 共 %d 行", table, pending)
    return True
