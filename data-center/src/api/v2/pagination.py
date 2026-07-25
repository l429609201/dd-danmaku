"""
分页 total 计算工具（性能优化）

背景：各列表接口原本每次翻页都执行一次 `query.count()`，在大表
（worker_request_logs / api_response_cache 等）上等于全表或全索引扫描，
是"数据量大页面很慢"的首要原因。

本模块提供统一的 total 求值策略：

1. 进程内短 TTL 缓存：同一组过滤条件的 total 在 TTL 内只算一次。
   翻页时过滤条件不变，故只有首次翻页付出 COUNT 代价。
2. 上限截断 COUNT：用 `SELECT COUNT(*) FROM (SELECT 1 ... LIMIT N)` 的形式，
   数据超过 N 行时 DB 可提前停止扫描，返回 N 并标记为估算值。
3. 显式跳过：调用方传 with_total=False 时完全不算，直接返回 -1，
   前端用"上一页/下一页"而不显示总数。

不用 Redis 而用进程内字典：total 是可容忍轻微过期的展示值，
进程内缓存零网络往返、零序列化，比 Redis 更适合这个场景。
"""
import logging
import threading
import time
from typing import Optional, Tuple

from sqlalchemy import func

logger = logging.getLogger(__name__)

# total 缓存：cache_key -> (total, is_estimated, 写入时间戳)
_total_cache: dict = {}
_cache_lock = threading.Lock()

# 缓存 TTL（秒）。列表页 total 略微滞后无影响，30 秒足够挡住翻页重复计算。
TOTAL_TTL = 30
# 缓存条目上限，超出则整体清空（防止过滤条件组合爆炸导致内存泄漏）
_CACHE_MAX = 500

# COUNT 截断上限：超过此行数就不再精确计数，返回该值并标记 estimated。
# 前端显示"约 50000+ 条"，用户实际不会翻到那么深的页。
COUNT_LIMIT = 50000


def _cache_get(key: str) -> Optional[Tuple[int, bool]]:
    """读 total 缓存；未命中或已过期返回 None"""
    with _cache_lock:
        entry = _total_cache.get(key)
        if not entry:
            return None
        total, estimated, at = entry
        if time.time() - at > TOTAL_TTL:
            _total_cache.pop(key, None)
            return None
        return total, estimated


def _cache_set(key: str, total: int, estimated: bool) -> None:
    """写 total 缓存"""
    with _cache_lock:
        if len(_total_cache) >= _CACHE_MAX:
            _total_cache.clear()
        _total_cache[key] = (total, estimated, time.time())


def invalidate_total_cache(prefix: str = "") -> int:
    """按前缀失效 total 缓存（增删数据后调用，保证总数及时刷新）

    prefix 为空时清空全部。返回清理条数。
    """
    with _cache_lock:
        if not prefix:
            n = len(_total_cache)
            _total_cache.clear()
            return n
        keys = [k for k in _total_cache if k.startswith(prefix)]
        for k in keys:
            _total_cache.pop(k, None)
        return len(keys)


def compute_total(db, query, cache_key: str, with_total: bool = True,
                  count_limit: int = COUNT_LIMIT) -> Tuple[int, bool]:
    """计算分页 total，返回 (total, is_estimated)

    参数：
        db          SQLAlchemy Session
        query       已应用全部过滤条件的 Query（不含 order_by/offset/limit）
        cache_key   缓存键，必须能唯一标识"表 + 全部过滤条件"
        with_total  False 时跳过计算，返回 (-1, False)
        count_limit 截断上限，超过则返回该值并标记为估算

    调用方在返回 -1 时应让前端隐藏总数、改用上下页导航。
    """
    if not with_total:
        return -1, False

    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        # 截断 COUNT：把原查询限制在 count_limit 行内再计数，
        # 让 DB 在扫到上限后即可停止，避免超大表全表扫描。
        limited = query.limit(count_limit).subquery()
        total = db.query(func.count()).select_from(limited).scalar() or 0
        estimated = total >= count_limit
    except Exception as e:
        # 子查询计数失败（个别方言/复杂查询）时回退到普通 count
        logger.debug(f"ℹ️ 截断 COUNT 失败，回退普通 count: {e}")
        try:
            total = query.count()
            estimated = False
        except Exception as e2:
            logger.warning(f"⚠️ total 计算失败: {e2}")
            return -1, False

    _cache_set(cache_key, total, estimated)
    return total, estimated


def build_cache_key(table: str, *parts) -> str:
    """拼装 total 缓存键：表名 + 各过滤条件值（None 统一为空串）"""
    norm = "|".join("" if p is None else str(p) for p in parts)
    return f"total:{table}:{norm}"
