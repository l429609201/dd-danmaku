"""复合索引补丁。"""
import logging

from sqlalchemy import inspect
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)
_COMPOSITE_INDEXES = {
    "control_messages": [("ix_cm_created_id", ["created_at", "id"])],
    "api_cache_access_logs": [("ix_acal_type_created", ["access_type", "created_at"])],
    "api_response_cache": [
        ("ix_arc_pending_fetched", ["refresh_pending", "fetched_at"]),
        ("ix_arc_empty_fetched", ["is_empty", "fetched_at"]),
    ],
    "ip_request_stats_current": [("ix_irsc_last_total", ["last_access_at", "total_count"])],
    "worker_metrics_snapshot": [("ix_wms_worker_snapshot", ["worker_id", "snapshot_at"])],
    "ip_rules": [
        ("ix_ip_rules_enabled_expires", ["enabled", "expires_at"]),
        ("ix_ip_rules_createdby_expires", ["created_by", "expires_at"]),
    ],
    "api_response_entities": [
        ("ix_are_type_lastseen", ["entity_type", "last_seen_at"]),
        ("ix_are_anime_ep", ["entity_type", "anime_id", "episode_number"]),
        ("ix_are_type_title", ["entity_type", "title"]),
    ],
    "media_alias": [("ix_ma_normns_status", ["alias_norm_ns", "status"])],
}


def add_composite_indexes(engine: Engine) -> bool:
    """按查询过滤列和排序列建立复合索引。"""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    dialect = engine.dialect.name
    changed = False
    errors = []
    for table, specs in _COMPOSITE_INDEXES.items():
        if table not in tables:
            continue
        existing = inspector.get_indexes(table)
        names = {index.get("name") for index in existing}
        colsets = {tuple(index.get("column_names") or []) for index in existing}
        table_cols = {column["name"] for column in inspector.get_columns(table)}
        for name, cols in specs:
            if name in names or tuple(cols) in colsets or not set(cols).issubset(table_cols):
                continue
            try:
                with engine.begin() as conn:
                    if dialect == "mysql":
                        columns = ", ".join(f"`{col}`" for col in cols)
                        conn.exec_driver_sql(f"CREATE INDEX `{name}` ON `{table}` ({columns})")
                    else:
                        columns = ", ".join(f'"{col}"' for col in cols)
                        conn.exec_driver_sql(
                            f'CREATE INDEX IF NOT EXISTS "{name}" ON "{table}" ({columns})')
                logger.info("📈 已创建复合索引 %s.%s", table, name)
                changed = True
            except Exception as exc:
                errors.append(f"{table}.{name}: {exc}")
    if errors:
        raise RuntimeError("；".join(errors))
    return changed
