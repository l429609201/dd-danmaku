"""
慢 SQL 监控服务

在 SQLAlchemy 引擎上挂 before/after_cursor_execute 钩子，测量每条 SQL 的
执行耗时，超过阈值（settings.SLOW_SQL_MS）的记录进内存环形缓冲。

用途：MCP / 外部诊断 API 可直接读到"哪条 SQL 慢、慢多少、执行过几次"，
不必开 DATABASE_ECHO 刷全量日志。

设计取舍：
- 只记录慢的，正常 SQL 零额外内存开销；
- 环形缓冲固定容量（默认 200 条），满了覆盖最旧的，不会无限增长；
- 同时按「SQL 指纹」聚合累计次数与最大/累计耗时，便于识别高频慢查询；
- 钩子里只做时间戳与字符串截断，不做任何 IO，开销可忽略。
"""
import logging
import re
import threading
import time
from collections import deque
from typing import Any, Dict, List

from sqlalchemy import event

logger = logging.getLogger(__name__)

# 最近的慢 SQL 明细（环形缓冲）
_RECENT_MAX = 200
_recent: deque = deque(maxlen=_RECENT_MAX)
# 按指纹聚合的统计：fingerprint -> {count, total_ms, max_ms, sample, last_at}
_agg: Dict[str, Dict[str, Any]] = {}
_lock = threading.Lock()
# 聚合条目上限，超出则清空重新统计（防止指纹爆炸占内存）
_AGG_MAX = 300

# SQL 语句最长保留字符数（避免超长 IN 列表把内存撑爆）
_SQL_MAX_LEN = 600

_installed = False
_threshold_ms = 200


def _fingerprint(sql: str) -> str:
    """把 SQL 归一化成指纹：去掉具体字面量，便于把同类查询聚成一条

    - 参数占位符（%s / ? / :name）统一为 ?
    - 数字字面量统一为 N
    - 连续空白压成单空格
    """
    s = re.sub(r"\s+", " ", sql).strip()
    s = re.sub(r"%\(\w+\)s|%s|:\w+|\?", "?", s)
    s = re.sub(r"\b\d+\b", "N", s)
    # IN (?, ?, ?, ...) 长度不同但语义相同，统一折叠
    s = re.sub(r"IN \((?:\?(?:, )?)+\)", "IN (?)", s, flags=re.IGNORECASE)
    return s[:_SQL_MAX_LEN]


def install(engine, threshold_ms: int = 200) -> None:
    """在引擎上安装慢 SQL 钩子（幂等，重复调用只装一次）"""
    global _installed, _threshold_ms
    if _installed:
        return
    _threshold_ms = max(1, int(threshold_ms))

    @event.listens_for(engine, "before_cursor_execute")
    def _before(conn, cursor, statement, parameters, context, executemany):
        # 用 info 字典挂起始时间，天然按连接隔离，多线程安全
        conn.info.setdefault("_slow_sql_t0", []).append(time.perf_counter())

    @event.listens_for(engine, "after_cursor_execute")
    def _after(conn, cursor, statement, parameters, context, executemany):
        stack = conn.info.get("_slow_sql_t0")
        if not stack:
            return
        t0 = stack.pop()
        elapsed_ms = (time.perf_counter() - t0) * 1000
        if elapsed_ms < _threshold_ms:
            return
        _record(statement, elapsed_ms, executemany)

    _installed = True
    logger.info(f"🐢 慢 SQL 监控已启用（阈值 {_threshold_ms}ms）")


def _record(statement: str, elapsed_ms: float, executemany: bool) -> None:
    """记录一条慢 SQL（明细 + 指纹聚合）"""
    sql = (statement or "")[:_SQL_MAX_LEN]
    fp = _fingerprint(sql)
    now_ts = time.time()
    with _lock:
        _recent.append({
            "sql": sql,
            "duration_ms": round(elapsed_ms, 1),
            "executemany": bool(executemany),
            "at": now_ts,
        })
        if len(_agg) >= _AGG_MAX and fp not in _agg:
            _agg.clear()
        entry = _agg.get(fp)
        if entry is None:
            _agg[fp] = {
                "count": 1,
                "total_ms": round(elapsed_ms, 1),
                "max_ms": round(elapsed_ms, 1),
                "sample": sql,
                "last_at": now_ts,
            }
        else:
            entry["count"] += 1
            entry["total_ms"] = round(entry["total_ms"] + elapsed_ms, 1)
            entry["max_ms"] = max(entry["max_ms"], round(elapsed_ms, 1))
            entry["last_at"] = now_ts


def get_stats(top: int = 20) -> dict:
    """慢 SQL 汇总：按累计耗时排序的 Top N 指纹 + 最近明细

    返回结构直接给诊断 API / MCP 用，不需要二次加工。
    """
    with _lock:
        items: List[dict] = []
        for fp, e in _agg.items():
            items.append({
                "fingerprint": fp,
                "count": e["count"],
                "total_ms": e["total_ms"],
                "max_ms": e["max_ms"],
                "avg_ms": round(e["total_ms"] / e["count"], 1) if e["count"] else 0,
                "sample": e["sample"],
                "last_at": e["last_at"],
            })
        recent = list(_recent)[-top:]
    items.sort(key=lambda x: x["total_ms"], reverse=True)
    return {
        "enabled": _installed,
        "threshold_ms": _threshold_ms,
        "unique_slow_queries": len(items),
        "top": items[:top],
        "recent": list(reversed(recent)),
    }


def reset() -> None:
    """清空统计（排查时手动归零，重新观察一段时间）"""
    with _lock:
        _recent.clear()
        _agg.clear()
