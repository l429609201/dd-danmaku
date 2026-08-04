"""冗余索引清理补丁。"""
import logging

from sqlalchemy import inspect
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)
_UNUSED_INDEX_COLUMNS = {
    "api_response_cache": {
        "source", "method", "status_code", "body_hash", "request_body_hash",
        "redis_key", "storage_mode", "last_used_at", "last_refresh_at", "client_ip",
    },
    "api_cache_access_logs": {"cache_key", "api_path", "worker_request_id"},
    "api_response_entities": {"title", "api_path", "cache_key"},
    "episode_links": {
        "local_title", "season_number", "episode_number", "file_name_hash",
        "source_cache_key", "bangumi_cache_key", "comment_cache_key",
        "verified_by_user_id",
    },
}


def drop_unused_indexes(engine: Engine) -> bool:
    """删除无查询收益的普通单列索引，降低高频写入放大。"""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    changed = False
    errors = []
    for table, drop_cols in _UNUSED_INDEX_COLUMNS.items():
        if table not in tables:
            continue
        for index in inspector.get_indexes(table):
            cols = index.get("column_names") or []
            name = index.get("name")
            if index.get("unique") or len(cols) != 1 or cols[0] not in drop_cols or not name:
                continue
            try:
                with engine.begin() as conn:
                    if engine.dialect.name == "mysql":
                        conn.exec_driver_sql(f"DROP INDEX `{name}` ON `{table}`")
                    else:
                        conn.exec_driver_sql(f'DROP INDEX IF EXISTS "{name}"')
                logger.info("🗑️ 已删除冗余索引 %s.%s", table, name)
                changed = True
            except Exception as exc:
                errors.append(f"{table}.{name}: {exc}")
    if errors:
        raise RuntimeError("；".join(errors))
    return changed
