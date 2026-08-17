"""
别名自动补充后台任务。

周期扫增量数据补别名，两个子任务各自可独立开关：
- B：新写入的有结果搜索缓存 → cache_extract_1/n 别名
- C：新增的空结果负缓存      → auto_match 候选（pending，待人工确认）

刻意不含子任务 A（bangumi titles/onlineDatabases 提取）——
entity_service._index_with_db 已在实体落库时同步提取，这里再扫一遍是重复劳动。
存量数据由本服务的 _backfill_once_if_needed 一次性回填负责（首轮循环前执行）。

配置全部存 app_settings，前端可改开关与间隔，不需要改代码调参。
"""
import asyncio
import logging
from typing import Optional

from src.database import get_db_sync
from src.models_v2 import ApiResponseEntity, AppSetting
from src.services_v2.media_meta_service import media_meta_service

logger = logging.getLogger(__name__)

# 增量水位线的存储键：记上次处理到的 api_response_cache.id，
# 每轮只扫新增部分，避免每次全表重扫。
WATERMARK_KEY = "alias_supplement_last_cache_id"

# 一次性存量回填的完成标记。存量提取只需跑一次，之后由 entity_service
# 的增量挂钩与本服务的周期任务持续补充。
BACKFILL_FLAG_KEY = "media_meta_backfill_done"


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
        # 先跑存量回填（仅首次）。原先放在 main.py 里 import scripts 包执行，
        # 但 scripts/ 不在容器镜像内（只拷了 src/），线上一直报
        # "No module named 'scripts'" 从未真正执行过。搬进本服务后随 src/ 一起打包。
        try:
            await asyncio.to_thread(self._backfill_once_if_needed)
        except Exception as e:
            logger.error(f"❌ 存量回填失败（下次启动重试）: {e}")
        # 回填后再等一段，避免紧接着又抢 DB 连接
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

    # ---------- 存量一次性回填（原 scripts/backfill_media_meta.py） ----------

    def _backfill_once_if_needed(self) -> dict:
        """未跑过则执行一次全量回填，跑过直接跳过。

        失败不写标记，下次启动重试。
        """
        if self._get_bool(BACKFILL_FLAG_KEY, False):
            return {"skipped": True}
        logger.info("🚀 首次启动：回填存量媒体外部ID与别名...")
        s1 = self._backfill_bangumi(200)
        s2 = self._backfill_cache_terms(2000)
        self._set_setting(BACKFILL_FLAG_KEY, "true")
        logger.info(
            f"✅ 存量回填完成：bangumi {s1['scanned']} 条"
            f"(外部ID {s1['ext_ids']}/别名 {s1['aliases']}/失败 {s1['failed']})，"
            f"缓存词 {s2['scanned']} 条"
            f"(approved {s2['approved']}/pending {s2['pending']})"
        )
        return {"skipped": False, "bangumi": s1, "cache": s2}

    @staticmethod
    def _backfill_bangumi(batch: int = 200) -> dict:
        """扫全部 bangumi 实体，提取外部 ID 与官方别名。

        按主键游标分页而非 offset：中途有新数据插入也不会漏行或重复。
        """
        stat = {"scanned": 0, "ext_ids": 0, "aliases": 0, "failed": 0}
        last_id = 0
        db = get_db_sync()
        try:
            while True:
                rows = (
                    db.query(ApiResponseEntity)
                    .filter(
                        ApiResponseEntity.entity_type == "bangumi",
                        ApiResponseEntity.raw_json.isnot(None),
                        ApiResponseEntity.id > last_id,
                    )
                    .order_by(ApiResponseEntity.id)
                    .limit(batch)
                    .all()
                )
                if not rows:
                    break
                for row in rows:
                    last_id = row.id
                    stat["scanned"] += 1
                    try:
                        n_ext, n_alias = media_meta_service.ingest_bangumi_raw(
                            db, row.entity_id, row.raw_json or {})
                        stat["ext_ids"] += n_ext
                        stat["aliases"] += n_alias
                    except Exception as ex:
                        stat["failed"] += 1
                        logger.warning(f"⚠️ animeId={row.entity_id} 提取失败: {ex}")
                # 每批提交一次：单事务过大会拉长锁持有时间
                db.commit()
        finally:
            db.close()
        return stat

    @staticmethod
    def _backfill_cache_terms(batch: int = 2000) -> dict:
        """扫有结果搜索缓存，提取搜索词别名"""
        total = {"scanned": 0, "approved": 0, "pending": 0,
                 "skipped_wide": 0, "skipped_noterm": 0}
        min_id = 0
        db = get_db_sync()
        try:
            while True:
                stat = media_meta_service.ingest_cache_search_terms(
                    db, min_cache_id=min_id, limit=batch)
                if stat["scanned"] == 0:
                    break
                db.commit()
                for k in total:
                    total[k] += stat.get(k, 0)
                # 水位未推进说明已到末尾，防止空转死循环
                if stat["max_cache_id"] <= min_id:
                    break
                min_id = stat["max_cache_id"]
        finally:
            db.close()
        return total

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
