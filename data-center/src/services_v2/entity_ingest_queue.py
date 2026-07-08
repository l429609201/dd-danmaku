"""
实体/集数解析异步批量落库队列。

Worker cache.upsert 高频触发解析，若每条即时落库会放大写入 QPS。
这里用内存队列缓冲，后台单消费者协程攒批（时间或条数触发），
共享一个 DB session 批量处理多条，显著减少 commit/fsync 次数。

丢失容忍：队列在内存，进程重启丢失未落库项——实体/集数是可从缓存重建的
派生数据（有 rebuild_from_cache），非关键，可接受。
"""
import asyncio
import logging

from src.database import get_db_sync
from src.services_v2.entity_service import (
    entity_index_service, episode_link_service,
)

logger = logging.getLogger(__name__)

# 攒批参数：满 BATCH_SIZE 条或距上次落库超过 FLUSH_INTERVAL 秒即刷库
BATCH_SIZE = 50
FLUSH_INTERVAL = 2.0
# 队列上限：防止上游突发导致内存无界增长；满了丢最旧（派生数据可重建）
QUEUE_MAX = 5000


class EntityIngestQueue:
    """实体/集数解析的异步批量落库队列"""

    def __init__(self):
        self._queue: asyncio.Queue = None  # 延迟到 start 时创建，绑定运行中 loop
        self._task = None
        self._running = False
        # 可观测计数：累计投递 / 累计丢弃 / 累计落库
        self._submitted = 0
        self._dropped = 0
        self._flushed = 0

    def stats(self) -> dict:
        """运行时可观测指标（供外部诊断 API）"""
        depth = self._queue.qsize() if self._queue is not None else 0
        return {
            "depth": depth,
            "capacity": QUEUE_MAX,
            "submitted": self._submitted,
            "dropped": self._dropped,
            "flushed": self._flushed,
            "running": self._running,
        }

    async def start(self):
        if self._task and not self._task.done():
            return
        self._queue = asyncio.Queue(maxsize=QUEUE_MAX)
        self._running = True
        self._task = asyncio.create_task(self._consume_loop())
        logger.info("✅ 实体/集数解析批量落库队列已启动")

    async def stop(self):
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None
        # 关闭前把队列里剩余项尽量刷库，减少重启丢失
        drain = []
        if self._queue is not None:
            while not self._queue.empty():
                try:
                    drain.append(self._queue.get_nowait())
                except Exception:
                    break
        if drain:
            try:
                await asyncio.to_thread(self._flush_batch, drain)
            except Exception:
                pass

    def submit(self, api_path: str, cache_key: str, body: str):
        """投递一条解析任务（非阻塞）；队列满则丢最旧，保证不阻塞上游"""
        if self._queue is None:
            return
        item = (api_path, cache_key, body)
        try:
            self._queue.put_nowait(item)
            self._submitted += 1
        except asyncio.QueueFull:
            try:
                self._queue.get_nowait()  # 丢最旧
                self._dropped += 1
                self._queue.put_nowait(item)
                self._submitted += 1
            except Exception:
                pass

    async def _consume_loop(self):
        """消费循环：攒够 BATCH_SIZE 或超时 FLUSH_INTERVAL 就批量落库"""
        while self._running:
            batch = []
            try:
                # 阻塞等第一条，避免空转
                first = await self._queue.get()
                batch.append(first)
                # 在 FLUSH_INTERVAL 内尽量多攒，直到满 BATCH_SIZE
                deadline = asyncio.get_event_loop().time() + FLUSH_INTERVAL
                while len(batch) < BATCH_SIZE:
                    timeout = deadline - asyncio.get_event_loop().time()
                    if timeout <= 0:
                        break
                    try:
                        item = await asyncio.wait_for(self._queue.get(), timeout=timeout)
                        batch.append(item)
                    except asyncio.TimeoutError:
                        break
            except asyncio.CancelledError:
                break
            if batch:
                # 同步批量落库放线程池，避免阻塞事件循环
                await asyncio.to_thread(self._flush_batch, batch)
                self._flushed += len(batch)

    @staticmethod
    def _flush_batch(batch):
        """共享一个 session 批量处理整批，最后一次性 commit（减少 fsync）。
        整批 commit 失败时回退为逐条独立事务，避免一条坏数据拖垮整批。"""
        db = get_db_sync()
        try:
            for api_path, cache_key, body in batch:
                try:
                    entity_index_service._index_with_db(db, api_path, cache_key, body)
                    episode_link_service._link_with_db(db, api_path, cache_key, body)
                    # session 为 autoflush=False：每条处理后手动 flush，
                    # 使后续条目的 existing 查询能看到本条新增对象，
                    # 避免跨 body 重复实体（尤其 MediaLibrary.anime_id 唯一约束冲突）
                    db.flush()
                except Exception as e:
                    logger.warning(f"⚠️ 单条实体/集数解析失败（跳过）: {e}")
                    db.rollback()  # 回滚坏条，保持 session 干净供后续条目复用
            db.commit()
        except Exception as e:
            db.rollback()
            logger.warning(f"⚠️ 实体/集数整批提交失败，回退逐条重试: {e}")
            EntityIngestQueue._flush_one_by_one(batch)
        finally:
            db.close()

    @staticmethod
    def _flush_one_by_one(batch):
        """逐条独立事务落库（整批失败时的兜底，隔离坏数据）"""
        for api_path, cache_key, body in batch:
            db = get_db_sync()
            try:
                entity_index_service._index_with_db(db, api_path, cache_key, body)
                episode_link_service._link_with_db(db, api_path, cache_key, body)
                db.commit()
            except Exception as e:
                db.rollback()
                logger.warning(f"⚠️ 单条实体/集数落库失败（丢弃）: {e}")
            finally:
                db.close()


entity_ingest_queue = EntityIngestQueue()
