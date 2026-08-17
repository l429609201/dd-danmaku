"""数据库补丁稳定注册表。"""
from src.db_patches.backfills import (
    backfill_alias_norm_ns,
    backfill_entity_anime_episode,
)
from src.db_patches.destructive import (
    drop_sign_zombie_columns,
    drop_worker_request_logs,
)
from src.db_patches.entity import add_entity_unique_key
from src.db_patches.index_cleanup import drop_unused_indexes
from src.db_patches.indexes import add_composite_indexes
from src.db_patches.policies import access_log_retention_14d
from src.db_patches.schema import (
    widen_access_log_cache_key,
    widen_cache_response_body,
)
from src.db_patches.types import Patch

# patch_id 一经发布不可修改；函数改名不影响历史判断。
PATCHES = [
    Patch("2026-08-01-drop-unused-indexes", "删除缓存相关冗余单列索引", drop_unused_indexes),
    Patch("2026-08-02-widen-cache-body", "缓存响应正文扩为 MEDIUMTEXT", widen_cache_response_body),
    Patch("2026-08-03-widen-access-key", "访问日志缓存键扩为 2000", widen_access_log_cache_key),
    Patch("2026-08-04-add-composite-indexes", "建立高频查询复合索引", add_composite_indexes),
    Patch("2026-08-05-backfill-entity-fields", "回填实体番剧ID和集号", backfill_entity_anime_episode),
    Patch("2026-08-06-backfill-alias-norm", "回填别名无空白标准列", backfill_alias_norm_ns),
    Patch("2026-08-07-access-log-retention", "缓存访问日志旧默认迁移为14天", access_log_retention_14d),
]

# 不可逆补丁不进入默认注册表；仅显式开启时由兼容入口追加。
DESTRUCTIVE_PATCHES = [
    Patch(
        "2026-08-90-drop-sign-zombie-columns",
        "删除签名重构遗留列（不可逆）",
        drop_sign_zombie_columns,
        destructive=True,
    ),
    Patch(
        "2026-08-91-entity-unique-key",
        "实体去重并建立唯一键（不可逆）",
        add_entity_unique_key,
        destructive=True,
    ),
    Patch(
        "2026-08-92-drop-worker-request-logs",
        "删除已迁移到文件的旧Worker日志表（不可逆）",
        drop_worker_request_logs,
        destructive=True,
    ),
]
