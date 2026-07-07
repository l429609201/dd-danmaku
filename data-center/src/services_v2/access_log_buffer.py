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


class AccessLogBuffer:
    """访问日志批量落库缓冲"""

    def __init__(self):
        self._buf = deque(maxlen=BUFFER_MAX)
        self._task = None
        self._running = False

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
        """投递一条访问日志（同步非阻塞）；deque 满自动丢最旧"""
        self._buf.append({
            "cache_key": cache_key,
            "api_path": api_path or "",
            "access_type": access_type,
            "upstream_status": upstream_status,
            "served_status": served_status,
            "worker_request_id": worker_request_id,
            "client_ip": client_ip,
            "created_at": now(),
        })

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
        except Exception as e:
            db.rollback()
            logger.warning(f"⚠️ 访问日志批量写入失败（丢弃 {len(rows)} 条）: {e}")
        finally:
            db.close()


access_log_buffer = AccessLogBuffer()
