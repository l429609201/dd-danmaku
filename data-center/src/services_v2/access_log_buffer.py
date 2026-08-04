"""
缓存访问日志（api_cache_access_logs）批量异步写入缓冲。

access_log 是全链路最高频写入表：每次 cache.get / cache.upsert 都写一条。
逐条 insert+commit 会放大写入 QPS 与 fsync 次数。这里改为内存缓冲 +
后台协程定时批量 bulk insert，显著降低写入压力。

丢失容忍：缓冲在内存，进程重启丢失未落库日志——访问日志是可观测数据、
非业务关键，可接受少量丢失换取写入性能。
"""
import asyncio
import logging
from collections import deque

from src.database import get_db_sync
from src.models_v2 import ApiCacheAccessLog
from src.models_v2.base import now

logger = logging.getLogger(__name__)

# 攒批参数：满 BATCH_SIZE 条或每 FLUSH_INTERVAL 秒刷库
BATCH_SIZE = 200
FLUSH_INTERVAL = 2.0
# 缓冲上限：满了丢最旧（日志可丢），防止内存无界增长
BUFFER_MAX = 20000
# 列宽上限（与 ApiCacheAccessLog 模型保持一致）。
# cache_key 取 2000：本表无索引，不受 InnoDB 3072 字节索引键限制，
# 因此可以比 api_response_cache（受 UNIQUE 索引约束、上限 768 字符）宽得多，
# 保证访问日志里的键与真实缓存键一致，不因截断而无法关联排查。
# 这里的截断只是最后兜底——超长值会触发 DataError 1406，
# 而 bulk_insert 单事务会让一条坏数据连坐同批全部日志。
CACHE_KEY_MAX = 2000
API_PATH_MAX = 300


def _clip(value, limit: int):
    """按列宽截断字符串；None 原样返回"""
    if value is None:
        return None
    s = str(value)
    return s[:limit] if len(s) > limit else s


class AccessLogBuffer:
    """访问日志批量落库缓冲"""

    def __init__(self):
        self._buf = deque(maxlen=BUFFER_MAX)
        self._task = None
        self._running = False
        # 可观测计数：累计投递 / 累计落库
        self._submitted = 0
        self._flushed = 0

    def stats(self) -> dict:
        """运行时可观测指标（供外部诊断 API）。
        dropped 由 submitted-flushed-depth 估算（deque 满自动丢最旧头部）"""
        depth = len(self._buf)
        dropped = max(0, self._submitted - self._flushed - depth)
        return {
            "depth": depth,
            "capacity": BUFFER_MAX,
            "submitted": self._submitted,
            "flushed": self._flushed,
            "dropped_est": dropped,
            "running": self._running,
        }

    async def start(self):
        if self._task and not self._task.done():
            return
        self._running = True
        self._task = asyncio.create_task(self._flush_loop())
        logger.info("✅ 访问日志批量写入缓冲已启动")

    async def stop(self):
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None
        # 退出前尽量把剩余日志刷一次
        try:
            self._flush_once()
        except Exception:
            pass

    def submit(self, cache_key, api_path, access_type,
               upstream_status=None, served_status=None,
               worker_request_id=None, client_ip=None):
        """投递一条访问日志（同步非阻塞）；deque 满自动丢最旧。

        入队即按列宽截断：异常长的搜索词（如带整段描述的垃圾请求，
        URL 编码后可达数千字符）会触发 DataError 1406，
        而 bulk_insert 是整批一个事务，一条坏数据会连坐同批全部日志。
        """
        self._buf.append({
            "cache_key": _clip(cache_key, CACHE_KEY_MAX),
            "api_path": _clip(api_path or "", API_PATH_MAX),
            "access_type": access_type,
            "upstream_status": upstream_status,
            "served_status": served_status,
            "worker_request_id": worker_request_id,
            "client_ip": client_ip,
            "created_at": now(),
        })
        self._submitted += 1

    async def _flush_loop(self):
        """定时刷库循环：每 FLUSH_INTERVAL 秒或缓冲超阈值就批量落库"""
        while self._running:
            try:
                await asyncio.sleep(FLUSH_INTERVAL)
            except asyncio.CancelledError:
                break
            if self._buf:
                # 批量落库放线程池，避免阻塞事件循环
                await asyncio.to_thread(self._flush_once)

    def _flush_once(self):
        """取出当前缓冲全部条目，分批 bulk insert（一次事务多条）"""
        if not self._buf:
            return
        # 一次性抽干缓冲（deque.popleft 循环，避免长时间持有）
        rows = []
        while self._buf and len(rows) < BUFFER_MAX:
            try:
                rows.append(self._buf.popleft())
            except IndexError:
                break
        if not rows:
            return
        db = get_db_sync()
        try:
            # 分批 bulk_insert_mappings，比逐条 add 快一个量级
            for i in range(0, len(rows), BATCH_SIZE):
                chunk = rows[i:i + BATCH_SIZE]
                db.bulk_insert_mappings(ApiCacheAccessLog, chunk)
            db.commit()
            self._flushed += len(rows)
        except Exception as e:
            db.rollback()
            # 整批失败降级为按小批重试：bulk_insert 是单事务，
            # 一条坏数据会连坐整批。入队已做截断，这里兜住未预料的异常值，
            # 让坏数据只丢自己所在的小批而非全部。
            logger.warning(f"⚠️ 访问日志批量写入失败，降级小批重试: {e}")
            saved = self._flush_degraded(db, rows)
            self._flushed += saved
            if saved < len(rows):
                logger.warning(
                    f"⚠️ 访问日志降级写入后仍丢弃 {len(rows) - saved} 条")
        finally:
            db.close()

    @staticmethod
    def _flush_degraded(db, rows) -> int:
        """降级写入：按 20 条一小批提交，返回成功条数。

        不逐条提交——访问日志量极大（现网 93 万行），逐条 commit 会产生
        大量 fsync 拖慢事件循环；20 条一批在「隔离坏数据」与「写入开销」
        之间取平衡。
        """
        saved = 0
        step = 20
        for i in range(0, len(rows), step):
            chunk = rows[i:i + step]
            try:
                db.bulk_insert_mappings(ApiCacheAccessLog, chunk)
                db.commit()
                saved += len(chunk)
            except Exception:
                db.rollback()
        return saved


access_log_buffer = AccessLogBuffer()
