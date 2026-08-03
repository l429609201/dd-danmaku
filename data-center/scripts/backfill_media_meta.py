"""
一次性回填脚本：把存量数据里的外部平台 ID 与别名提取进新表。

两个来源（可分别开关）：
- bangumi 实体 raw_json → media_external_ids + media_alias(dandanplay_titles)
- 有结果搜索缓存        → media_alias(cache_extract_1 / cache_extract_n)

与增量挂钩共用 media_meta_service 的同一套函数，不存在两份逻辑。
幂等：重复执行只会更新已有行，不产生重复记录（依赖表上的唯一约束）。

用法（在 data-center 目录下执行）：
    python -m scripts.backfill_media_meta                # 两个来源都跑
    python -m scripts.backfill_media_meta --only bangumi # 只跑 bangumi
    python -m scripts.backfill_media_meta --only cache   # 只跑缓存词
    python -m scripts.backfill_media_meta --batch 200    # 自定义批大小
"""
import argparse
import logging
import sys

from src.database import get_db_sync
from src.models_v2 import ApiResponseEntity, AppSetting
from src.services_v2.media_meta_service import media_meta_service

# 一次性回填的完成标记。存量提取只需跑一次，之后由 entity_service 的增量
# 挂钩持续补充，所以用 app_settings 记一个标记防止每次重启都全表重扫。
DONE_FLAG_KEY = "media_meta_backfill_done"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("backfill")


def backfill_bangumi(batch: int = 200) -> dict:
    """扫全部 bangumi 实体，提取外部 ID 与官方别名。

    按主键分页而非 offset：offset 在几千行量级虽不致命，但主键游标写法
    在中途新增数据时也不会漏行或重复。
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
            # 每批提交一次：单次事务过大在几千行量级会拉长锁持有时间
            db.commit()
            logger.info(
                f"📦 bangumi 已处理 {stat['scanned']} 条 "
                f"(外部ID {stat['ext_ids']} / 别名 {stat['aliases']})"
            )
    finally:
        db.close()
    return stat


def backfill_cache_terms(batch: int = 2000) -> dict:
    """扫有结果搜索缓存，提取搜索词别名。

    ingest_cache_search_terms 内部已做分档与跳过逻辑，这里只负责翻页与提交。
    """
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
            # max_cache_id 未推进说明已到末尾，防止空转死循环
            if stat["max_cache_id"] <= min_id:
                break
            min_id = stat["max_cache_id"]
            logger.info(
                f"📦 缓存词已处理 {total['scanned']} 条 "
                f"(approved {total['approved']} / pending {total['pending']})"
            )
    finally:
        db.close()
    return total


def _flag_done() -> bool:
    """读一次性回填完成标记"""
    db = get_db_sync()
    try:
        row = db.query(AppSetting).filter(AppSetting.key == DONE_FLAG_KEY).first()
        return bool(row and str(row.value).lower() in ("1", "true", "yes", "on"))
    finally:
        db.close()


def _mark_done():
    """写完成标记；缺失则创建"""
    db = get_db_sync()
    try:
        row = db.query(AppSetting).filter(AppSetting.key == DONE_FLAG_KEY).first()
        if not row:
            row = AppSetting(
                key=DONE_FLAG_KEY, value="true", value_type="bool",
                description="媒体外部ID/别名一次性回填是否已完成", is_secret=False,
            )
            db.add(row)
        else:
            row.value = "true"
        db.commit()
    finally:
        db.close()


def run_once_if_needed() -> dict:
    """启动时调用：未跑过则执行一次全量回填，跑过则直接跳过。

    这是「一次性任务」的入口——存量数据只需提取一次，之后由
    entity_service 的增量挂钩持续补充新入库的 bangumi 实体。
    失败不写标记，下次启动会重试；异常一律吞掉，不阻塞服务启动。
    """
    if _flag_done():
        return {"skipped": True}
    try:
        logger.info("🚀 首次启动：回填存量媒体外部ID与别名...")
        s1 = backfill_bangumi(200)
        s2 = backfill_cache_terms(2000)
        _mark_done()
        logger.info(
            f"✅ 一次性回填完成：bangumi {s1['scanned']} 条"
            f"(外部ID {s1['ext_ids']}/别名 {s1['aliases']})，"
            f"缓存词 {s2['scanned']} 条"
            f"(approved {s2['approved']}/pending {s2['pending']})"
        )
        return {"skipped": False, "bangumi": s1, "cache": s2}
    except Exception as ex:
        # 不写标记，下次启动重试
        logger.error(f"❌ 一次性回填失败（下次启动重试）: {ex}")
        return {"skipped": False, "error": str(ex)}


def main() -> int:
    ap = argparse.ArgumentParser(description="媒体外部ID与别名回填")
    ap.add_argument("--only", choices=["bangumi", "cache"], default=None,
                    help="只跑指定来源，默认两个都跑")
    ap.add_argument("--batch", type=int, default=0,
                    help="批大小，0 表示各来源用默认值")
    args = ap.parse_args()

    if args.only in (None, "bangumi"):
        logger.info("🚀 开始回填 bangumi 外部ID与官方别名...")
        s = backfill_bangumi(args.batch or 200)
        logger.info(
            f"✅ bangumi 完成：扫描 {s['scanned']}，外部ID {s['ext_ids']}，"
            f"别名 {s['aliases']}，失败 {s['failed']}"
        )

    if args.only in (None, "cache"):
        logger.info("🚀 开始回填缓存搜索词别名...")
        s = backfill_cache_terms(args.batch or 2000)
        logger.info(
            f"✅ 缓存词完成：扫描 {s['scanned']}，approved {s['approved']}，"
            f"pending {s['pending']}，跳过(过宽) {s['skipped_wide']}，"
            f"跳过(无词) {s['skipped_noterm']}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
