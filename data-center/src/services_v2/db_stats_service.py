"""
数据库与 Redis 状态探查服务

提供仪表盘「数据库」页所需的统计：
- SQL：方言、各表行数/占用大小/占比、总大小、连接池状态
- Redis：版本、内存、连接数、命中率、key 数量（未启用则标注降级）

跨方言：SQLite(dbstat/page_count) / MySQL(information_schema) / PostgreSQL(pg_total_relation_size)。
"""
import logging
from typing import Any, Dict, List

from sqlalchemy import inspect, text

from src.database import engine, get_db_sync
from src.services_v2.redis_cache import redis_cache

logger = logging.getLogger(__name__)


def _table_names() -> List[str]:
    try:
        return list(inspect(engine).get_table_names())
    except Exception:
        return []


def _sqlite_sizes(conn) -> Dict[str, int]:
    """SQLite：用 dbstat 取每表字节数；不可用则返回空"""
    sizes: Dict[str, int] = {}
    try:
        rows = conn.execute(text(
            "SELECT name, SUM(pgsize) FROM dbstat GROUP BY name"
        )).fetchall()
        for name, size in rows:
            sizes[name] = int(size or 0)
    except Exception as e:
        logger.debug(f"dbstat 不可用（需 SQLITE_ENABLE_DBSTAT_VTAB）: {e}")
    return sizes


def collect_sql_stats() -> Dict[str, Any]:
    """采集 SQL 表统计 + 总大小 + 连接池状态"""
    dialect = engine.dialect.name  # sqlite / mysql / postgresql
    tables: List[Dict[str, Any]] = []
    total_size = 0
    db = get_db_sync()
    try:
        names = _table_names()
        sqlite_sizes = {}
        if dialect == "sqlite":
            sqlite_sizes = _sqlite_sizes(db.connection())

        for name in names:
            row_count = 0
            size_bytes = 0
            try:
                row_count = db.execute(
                    text(f"SELECT COUNT(*) FROM {name}")
                ).scalar() or 0
            except Exception:
                row_count = 0

            try:
                if dialect == "sqlite":
                    size_bytes = sqlite_sizes.get(name, 0)
                elif dialect == "mysql":
                    size_bytes = db.execute(text(
                        "SELECT COALESCE(data_length+index_length,0) "
                        "FROM information_schema.tables "
                        "WHERE table_schema=DATABASE() AND table_name=:n"
                    ), {"n": name}).scalar() or 0
                elif dialect == "postgresql":
                    size_bytes = db.execute(text(
                        "SELECT pg_total_relation_size(:n)"
                    ), {"n": name}).scalar() or 0
            except Exception:
                size_bytes = 0

            total_size += int(size_bytes or 0)
            tables.append({
                "name": name,
                "row_count": int(row_count),
                "size_bytes": int(size_bytes or 0),
            })
    finally:
        db.close()

    # 占比计算（基于已知大小总和）
    for t in tables:
        t["size_ratio"] = round(t["size_bytes"] / total_size * 100, 1) if total_size > 0 else 0.0
    tables.sort(key=lambda x: x["size_bytes"], reverse=True)

    pool = getattr(engine, "pool", None)
    pool_status = {}
    if pool is not None:
        try:
            pool_status = {
                "size": pool.size() if hasattr(pool, "size") else None,
                "checked_out": pool.checkedout() if hasattr(pool, "checkedout") else None,
                "overflow": pool.overflow() if hasattr(pool, "overflow") else None,
            }
        except Exception:
            pool_status = {}

    return {
        "dialect": dialect,
        "total_size_bytes": total_size,
        "table_count": len(tables),
        "tables": tables,
        "pool": pool_status,
    }


async def collect_redis_stats() -> Dict[str, Any]:
    """采集 Redis 状态；未启用/连接失败返回 enabled=False"""
    client = getattr(redis_cache, "_client", None)
    if not redis_cache.enabled or client is None:
        return {"enabled": False}
    try:
        info = await client.info()
        dbsize = await client.dbsize()
        hits = int(info.get("keyspace_hits", 0) or 0)
        misses = int(info.get("keyspace_misses", 0) or 0)
        hit_rate = round(hits / (hits + misses) * 100, 1) if (hits + misses) > 0 else 0.0
        return {
            "enabled": True,
            "version": info.get("redis_version"),
            "used_memory_bytes": int(info.get("used_memory", 0) or 0),
            "used_memory_human": info.get("used_memory_human"),
            "connected_clients": int(info.get("connected_clients", 0) or 0),
            "uptime_seconds": int(info.get("uptime_in_seconds", 0) or 0),
            "total_keys": int(dbsize or 0),
            "keyspace_hits": hits,
            "keyspace_misses": misses,
            "hit_rate": hit_rate,
        }
    except Exception as e:
        logger.warning(f"⚠️ Redis 状态采集失败: {e}")
        return {"enabled": True, "error": str(e)}


def collect_comment_store_stats() -> Dict[str, Any]:
    """采集本地端弹幕兜底存储统计：文件数、总大小、上限、占比"""
    from src.models_v2 import LocalCommentStore
    from src.services_v2.comment_store_service import MAX_STORE_BYTES
    db = get_db_sync()
    try:
        count = db.query(func.count(LocalCommentStore.id)).scalar() or 0
        total_size = db.query(
            func.coalesce(func.sum(LocalCommentStore.size_bytes), 0)
        ).scalar() or 0
        total_comments = db.query(
            func.coalesce(func.sum(LocalCommentStore.comment_count), 0)
        ).scalar() or 0
        ratio = round(int(total_size) / MAX_STORE_BYTES * 100, 1) if MAX_STORE_BYTES > 0 else 0.0
        return {
            "file_count": int(count),
            "total_size_bytes": int(total_size),
            "total_comments": int(total_comments),
            "max_bytes": MAX_STORE_BYTES,
            "usage_ratio": ratio,
        }
    except Exception as e:
        logger.warning(f"⚠️ 弹幕存储统计失败: {e}")
        return {"file_count": 0, "total_size_bytes": 0, "total_comments": 0,
                "max_bytes": MAX_STORE_BYTES, "usage_ratio": 0.0}
    finally:
        db.close()
