"""
数据库与 Redis 状态探查服务

提供仪表盘「数据库」页所需的统计：
- SQL：方言、各表行数/占用大小/占比、总大小、连接池状态
- Redis：版本、内存、连接数、命中率、key 数量（未启用则标注降级）

跨方言：SQLite(dbstat/page_count) / MySQL(information_schema) / PostgreSQL(pg_total_relation_size)。
"""
import logging
from typing import Any, Dict, List

from sqlalchemy import func, inspect, text

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
            "used_memory_peak_bytes": int(info.get("used_memory_peak", 0) or 0),
            "mem_fragmentation_ratio": float(info.get("mem_fragmentation_ratio", 0) or 0),
            "connected_clients": int(info.get("connected_clients", 0) or 0),
            "uptime_seconds": int(info.get("uptime_in_seconds", 0) or 0),
            "total_keys": int(dbsize or 0),
            "keyspace_hits": hits,
            "keyspace_misses": misses,
            "hit_rate": hit_rate,
            # 扩展性能指标
            "ops_per_sec": int(info.get("instantaneous_ops_per_sec", 0) or 0),
            "evicted_keys": int(info.get("evicted_keys", 0) or 0),
            "expired_keys": int(info.get("expired_keys", 0) or 0),
            "total_commands": int(info.get("total_commands_processed", 0) or 0),
            "rejected_connections": int(info.get("rejected_connections", 0) or 0),
        }
    except Exception as e:
        logger.warning(f"⚠️ Redis 状态采集失败: {e}")
        return {"enabled": True, "error": str(e)}


def collect_comment_store_stats() -> Dict[str, Any]:
    """采集本地端弹幕兜底存储统计：文件数、总大小、上限、占比"""
    from src.models_v2 import LocalCommentStore
    from src.services_v2.comment_store_service import comment_store_service
    max_bytes = comment_store_service.get_max_bytes()
    db = get_db_sync()
    try:
        count = db.query(func.count(LocalCommentStore.id)).scalar() or 0
        total_size = db.query(
            func.coalesce(func.sum(LocalCommentStore.size_bytes), 0)
        ).scalar() or 0
        total_comments = db.query(
            func.coalesce(func.sum(LocalCommentStore.comment_count), 0)
        ).scalar() or 0
        ratio = round(int(total_size) / max_bytes * 100, 1) if max_bytes > 0 else 0.0
        return {
            "file_count": int(count),
            "total_size_bytes": int(total_size),
            "total_comments": int(total_comments),
            "max_bytes": max_bytes,
            "usage_ratio": ratio,
        }
    except Exception as e:
        logger.warning(f"⚠️ 弹幕存储统计失败: {e}")
        return {"file_count": 0, "total_size_bytes": 0, "total_comments": 0,
                "max_bytes": max_bytes, "usage_ratio": 0.0}
    finally:
        db.close()


def collect_engine_perf() -> Dict[str, Any]:
    """采集数据库引擎性能指标，按方言分派。

    统一返回结构，便于前端通用渲染分组卡片：
    {
      available: bool, dialect: str, version: str,
      groups: [ { title: str, items: [ {label, value, warn?} ] } ]
    }
    """
    dialect = engine.dialect.name  # sqlite / mysql / postgresql
    try:
        if dialect == "mysql":
            return _engine_perf_mysql()
        if dialect == "postgresql":
            return _engine_perf_postgresql()
        if dialect == "sqlite":
            return _engine_perf_sqlite()
        return {"available": False, "dialect": dialect,
                "note": f"暂不支持 {dialect} 的性能指标"}
    except Exception as e:
        logger.warning(f"⚠️ 引擎性能采集失败({dialect}): {e}")
        return {"available": False, "dialect": dialect, "error": str(e)}


def _engine_perf_mysql() -> Dict[str, Any]:
    """MySQL 性能指标：查询/连接/InnoDB/运行 四组"""
    db = get_db_sync()
    try:
        def _status(rows):
            return {k: v for k, v in rows}

        status = _status(db.execute(text(
            "SHOW GLOBAL STATUS WHERE Variable_name IN "
            "('Questions','Uptime','Threads_running','Threads_connected',"
            "'Slow_queries','Innodb_buffer_pool_read_requests',"
            "'Innodb_buffer_pool_reads','Aborted_connects','Max_used_connections',"
            "'Com_select','Com_insert','Com_update','Com_delete',"
            "'Innodb_rows_read','Innodb_rows_inserted','Innodb_rows_updated',"
            "'Innodb_rows_deleted','Bytes_received','Bytes_sent',"
            "'Open_tables','Table_locks_waited','Qcache_hits','Connections')"
        )).fetchall())
        variables = _status(db.execute(text(
            "SHOW VARIABLES WHERE Variable_name IN ('max_connections','version')"
        )).fetchall())

        def _i(d, k):
            try:
                return int(d.get(k, 0) or 0)
            except (TypeError, ValueError):
                return 0

        uptime = _i(status, "Uptime") or 1
        questions = _i(status, "Questions")
        bp_reads = _i(status, "Innodb_buffer_pool_reads")
        bp_req = _i(status, "Innodb_buffer_pool_read_requests") or 1
        bp_hit_rate = round((1 - bp_reads / bp_req) * 100, 2) if bp_req > 0 else 0.0
        max_conn = _i(variables, "max_connections") or 1
        threads_connected = _i(status, "Threads_connected")
        slow = _i(status, "Slow_queries")
        version = variables.get("version") or "—"

        def _fmt_bytes(n):
            n = int(n or 0)
            if n < 1024:
                return f"{n} B"
            if n < 1048576:
                return f"{n/1024:.1f} KB"
            if n < 1073741824:
                return f"{n/1048576:.1f} MB"
            return f"{n/1073741824:.2f} GB"

        groups = [
            {"title": "查询", "items": [
                {"label": "平均 QPS", "value": round(questions / uptime, 1)},
                {"label": "总查询数", "value": questions},
                {"label": "慢查询", "value": slow, "warn": slow > 0},
                {"label": "查询缓存命中", "value": _i(status, "Qcache_hits")},
            ]},
            {"title": "连接", "items": [
                {"label": "当前连接", "value": f"{threads_connected}/{max_conn}"},
                {"label": "连接使用率", "value": f"{round(threads_connected/max_conn*100,1)}%",
                 "warn": threads_connected / max_conn > 0.8},
                {"label": "运行线程", "value": _i(status, "Threads_running")},
                {"label": "历史最大连接", "value": _i(status, "Max_used_connections")},
                {"label": "失败连接", "value": _i(status, "Aborted_connects"),
                 "warn": _i(status, "Aborted_connects") > 0},
                {"label": "累计连接数", "value": _i(status, "Connections")},
            ]},
            {"title": "InnoDB", "items": [
                {"label": "缓冲池命中率", "value": f"{bp_hit_rate}%",
                 "warn": bp_hit_rate < 95},
                {"label": "逻辑读请求", "value": bp_req},
                {"label": "磁盘读", "value": bp_reads},
                {"label": "行读/写", "value": f"{_i(status,'Innodb_rows_read')}/{_i(status,'Innodb_rows_inserted')}"},
                {"label": "行更新/删除", "value": f"{_i(status,'Innodb_rows_updated')}/{_i(status,'Innodb_rows_deleted')}"},
            ]},
            {"title": "运行 / 网络", "items": [
                {"label": "运行时长", "value": _fmt_uptime(uptime)},
                {"label": "网络收/发", "value": f"{_fmt_bytes(_i(status,'Bytes_received'))} / {_fmt_bytes(_i(status,'Bytes_sent'))}"},
                {"label": "打开表数", "value": _i(status, "Open_tables")},
                {"label": "表锁等待", "value": _i(status, "Table_locks_waited"),
                 "warn": _i(status, "Table_locks_waited") > 0},
            ]},
        ]
        return {"available": True, "dialect": "mysql", "version": version,
                "groups": groups}
    finally:
        db.close()


def _fmt_uptime(s) -> str:
    """秒转可读时长"""
    s = int(s or 0)
    d, h, m = s // 86400, (s % 86400) // 3600, (s % 3600) // 60
    if d > 0:
        return f"{d}天{h}小时"
    if h > 0:
        return f"{h}小时{m}分"
    return f"{m}分"


def _engine_perf_sqlite() -> Dict[str, Any]:
    """SQLite 指标：版本/页大小/页数/journal模式/缓存/文件大小 等"""
    db = get_db_sync()
    try:
        conn = db.connection()

        def _scalar(sql):
            try:
                return conn.execute(text(sql)).scalar()
            except Exception:
                return None

        version = _scalar("SELECT sqlite_version()") or "—"
        page_size = int(_scalar("PRAGMA page_size") or 0)
        page_count = int(_scalar("PRAGMA page_count") or 0)
        freelist = int(_scalar("PRAGMA freelist_count") or 0)
        journal_mode = _scalar("PRAGMA journal_mode") or "—"
        cache_size = int(_scalar("PRAGMA cache_size") or 0)
        synchronous = _scalar("PRAGMA synchronous")
        file_size = page_size * page_count

        def _fmt_bytes(n):
            n = int(n or 0)
            if n < 1048576:
                return f"{n/1024:.1f} KB"
            if n < 1073741824:
                return f"{n/1048576:.1f} MB"
            return f"{n/1073741824:.2f} GB"

        sync_map = {0: "OFF", 1: "NORMAL", 2: "FULL", 3: "EXTRA"}
        groups = [
            {"title": "存储", "items": [
                {"label": "数据文件大小", "value": _fmt_bytes(file_size)},
                {"label": "页大小", "value": f"{page_size} B"},
                {"label": "页数量", "value": page_count},
                {"label": "空闲页", "value": freelist,
                 "warn": page_count > 0 and freelist / page_count > 0.25},
            ]},
            {"title": "运行模式", "items": [
                {"label": "journal 模式", "value": str(journal_mode).upper()},
                {"label": "同步模式", "value": sync_map.get(synchronous, str(synchronous))},
                {"label": "缓存页数", "value": cache_size},
                {"label": "SQLite 版本", "value": version},
            ]},
        ]
        return {"available": True, "dialect": "sqlite", "version": version,
                "groups": groups}
    finally:
        db.close()


def _engine_perf_postgresql() -> Dict[str, Any]:
    """PostgreSQL 指标：连接/缓存命中/事务/库大小 等"""
    db = get_db_sync()
    try:
        def _scalar(sql):
            try:
                return db.execute(text(sql)).scalar()
            except Exception:
                return None

        version = (_scalar("SHOW server_version") or "—")
        max_conn = int(_scalar("SHOW max_connections") or 1)
        cur_conn = int(_scalar(
            "SELECT count(*) FROM pg_stat_activity") or 0)
        active = int(_scalar(
            "SELECT count(*) FROM pg_stat_activity WHERE state='active'") or 0)
        # 当前库的统计（pg_stat_database）
        row = db.execute(text(
            "SELECT blks_hit, blks_read, xact_commit, xact_rollback, "
            "tup_returned, tup_fetched FROM pg_stat_database "
            "WHERE datname = current_database()"
        )).fetchone()
        blks_hit = int((row[0] if row else 0) or 0)
        blks_read = int((row[1] if row else 0) or 0)
        xact_commit = int((row[2] if row else 0) or 0)
        xact_rollback = int((row[3] if row else 0) or 0)
        total_blk = blks_hit + blks_read
        hit_rate = round(blks_hit / total_blk * 100, 2) if total_blk > 0 else 0.0
        db_size = _scalar("SELECT pg_database_size(current_database())") or 0

        def _fmt_bytes(n):
            n = int(n or 0)
            if n < 1048576:
                return f"{n/1024:.1f} KB"
            if n < 1073741824:
                return f"{n/1048576:.1f} MB"
            return f"{n/1073741824:.2f} GB"

        groups = [
            {"title": "连接", "items": [
                {"label": "当前连接", "value": f"{cur_conn}/{max_conn}"},
                {"label": "连接使用率", "value": f"{round(cur_conn/max_conn*100,1)}%",
                 "warn": cur_conn / max_conn > 0.8},
                {"label": "活跃查询", "value": active},
            ]},
            {"title": "缓存 / 事务", "items": [
                {"label": "缓存命中率", "value": f"{hit_rate}%", "warn": hit_rate < 95},
                {"label": "命中/磁盘读", "value": f"{blks_hit}/{blks_read}"},
                {"label": "事务提交", "value": xact_commit},
                {"label": "事务回滚", "value": xact_rollback, "warn": xact_rollback > 0},
            ]},
            {"title": "存储", "items": [
                {"label": "数据库大小", "value": _fmt_bytes(db_size)},
                {"label": "PG 版本", "value": version},
            ]},
        ]
        return {"available": True, "dialect": "postgresql", "version": version,
                "groups": groups}
    finally:
        db.close()


