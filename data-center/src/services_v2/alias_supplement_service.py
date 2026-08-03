"""
别名自动补充后台任务。

周期扫增量数据补别名，两个子任务各自可独立开关：
- B：新写入的有结果搜索缓存 → cache_extract_1/n 别名
- C：新增的空结果负缓存      → auto_match 候选（pending，待人工确认）

刻意不含子任务 A（bangumi titles/onlineDatabases 提取）——
entity_service._index_with_db 已在实体落库时同步提取，这里再扫一遍是重复劳动。
存量数据由 scripts/backfill_media_meta 的一次性任务负责。

配置全部存 app_settings，前端可改开关与间隔，不需要改代码调参。
"""
import asyncio
import logging
from typing import Optional

from src.database import get_db_sync
from src.models_v2 import AppSetting
from src.services_v2.media_meta_service import media_meta_service

logger = logging.getLogger(__name__)

# 增量水位线的存储键：记上次处理到的 api_response_cache.id，
# 每轮只扫新增部分，避免每次全表重扫。
WATERMARK_KEY = "alias_supplement_last_cache_id"


class AliasSupplementService:
    """别名自动补充周期任务"""

    def __init__(self):
        self._task: Optional[asyncio.Task] = None
        self._running = False
        # 可观测计数：累计轮次 / 累计新增 approved / 累计新增 pending
        self._rounds = 0
        self._added_approved = 0
        self._added_pending = 0

    def stats(self) -> dict:
        """运行时指标（供诊断接口）"""
        return {
            "running": self._running,
            "rounds": self._rounds,
            "added_approved": self._added_approved,
            "added_pending": self._added_pending,
        }

    async def start(self):
        if self._task and not self._task.done():
            return
        self._running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info("✅ 别名自动补充任务已启动")

    async def stop(self):
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None

    async def _run_loop(self):
        """按配置间隔循环执行；异常只记录，不影响主服务"""
        # 启动后先等一段再干活：避开启动时的一次性回填，别抢 DB 连接
        interval = await asyncio.to_thread(
            self._get_int, "alias_supplement_interval_seconds", 3600)
        await asyncio.sleep(min(300, max(60, interval)))
        while self._running:
            try:
                await self.run_once()
            except Exception as e:
                logger.error(f"❌ 别名自动补充失败: {e}")
            interval = await asyncio.to_thread(
                self._get_int, "alias_supplement_interval_seconds", 3600)
            await asyncio.sleep(max(300, interval))

    async def run_once(self) -> dict:
        """执行一轮补充。同步 DB 操作整体放线程池，避免阻塞事件循环。"""
        if not await asyncio.to_thread(
                self._get_bool, "alias_supplement_enabled", True):
            return {"enabled": False}
        result = await asyncio.to_thread(self._run_once_sync)
        self._rounds += 1
        self._added_approved += result.get("cache_approved", 0)
        self._added_pending += (result.get("cache_pending", 0)
                                + result.get("auto_matched", 0))
        return result

    def _run_once_sync(self) -> dict:
        """两个子任务的同步实现，共享一个 session"""
        out = {"cache_approved": 0, "cache_pending": 0, "auto_matched": 0}
        db = get_db_sync()
        try:
            # 子任务 B：增量扫有结果缓存，提取「搜索词 → animeId」
            if self._get_bool("alias_supplement_extract_cache", True):
                last_id = self._get_int(WATERMARK_KEY, 0)
                s = media_meta_service.ingest_cache_search_terms(
                    db, min_cache_id=last_id, limit=2000)
                db.commit()
                out["cache_approved"] = s.get("approved", 0)
                out["cache_pending"] = s.get("pending", 0)
                # 水位线只前进不回退，避免某轮异常导致重复处理
                new_id = s.get("max_cache_id", last_id)
                if new_id > last_id:
                    self._set_setting(WATERMARK_KEY, str(new_id))

            # 子任务 C：为新增空结果词生成候选（一律 pending）
            if self._get_bool("alias_supplement_auto_match", True):
                s = media_meta_service.generate_candidates(
                    db, limit=200, min_hit=1)
                db.commit()
                out["auto_matched"] = s.get("matched", 0)

            if any(out.values()):
                logger.info(
                    f"🔤 别名补充完成：缓存词 approved {out['cache_approved']}"
                    f"/pending {out['cache_pending']}，"
                    f"空结果候选 {out['auto_matched']}"
                )
            return out
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    # ---------- app_settings 读写（与 cleanup_service 同一套写法） ----------

    @staticmethod
    def _get_setting(key: str) -> Optional[str]:
        db = get_db_sync()
        try:
            row = db.query(AppSetting).filter(AppSetting.key == key).first()
            return row.value if row else None
        finally:
            db.close()

    @staticmethod
    def _set_setting(key: str, value: str):
        """写配置项；缺失则创建（水位线首次写入走这里）"""
        db = get_db_sync()
        try:
            row = db.query(AppSetting).filter(AppSetting.key == key).first()
            if not row:
                row = AppSetting(
                    key=key, value=value, value_type="int",
                    description="别名补充任务已处理的缓存最大ID", is_secret=False,
                )
                db.add(row)
            else:
                row.value = value
            db.commit()
        finally:
            db.close()

    def _get_int(self, key: str, default: int) -> int:
        try:
            value = self._get_setting(key)
            return int(value) if value not in (None, "") else default
        except Exception:
            return default

    def _get_bool(self, key: str, default: bool) -> bool:
        value = self._get_setting(key)
        if value in (None, ""):
            return default
        return str(value).lower() in ("1", "true", "yes", "on")


alias_supplement_service = AliasSupplementService()
