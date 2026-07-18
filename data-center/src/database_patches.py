"""
数据库补丁专用文件（database_patches）

职责分工：
- 「加列」等结构补齐由 SchemaGuard 自动完成（database_schema_guard.py）
- 本文件只放 SchemaGuard 做不了的「特殊补丁」，例如：
  数据回填 / 列重命名 / 索引调整 / 历史脏数据清理 / 一次性数据修正

补丁规范（务必遵守）：
1. 幂等：每个补丁必须可重复执行而不出错（先判断是否需要执行）
2. 独立：每个补丁单独 try，失败只记录日志，不影响其它补丁与启动
3. 安全：禁止删表/删列等不可逆操作；如确需，必须显式注释风险并人工确认
4. 注册：写好的补丁函数加到 _PATCHES 列表即生效

新增补丁步骤：
- 定义 def _patch_xxx(engine) -> bool: （返回 True=执行了变更，False=无需变更）
- 把它加进 _PATCHES 列表
"""
import logging
from typing import Callable, List

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)


# ============ 补丁实现区 ============
# 每个补丁签名：def _patch_xxx(engine: Engine) -> bool
# 返回 True 表示实际执行了变更（用于日志统计），False 表示检测后无需变更。

def _patch_example_noop(engine: Engine) -> bool:
    """示例补丁（占位）：演示幂等写法，实际不做任何变更。

    真实补丁可参考此结构：先用 inspector/查询判断是否需要执行，
    需要才执行，并返回是否变更。
    """
    inspector = inspect(engine)
    # 示例：检测某表是否存在再决定是否处理
    if "app_key_pool" not in inspector.get_table_names():
        return False
    # 这里不做任何变更，仅作为模板占位
    return False


# 缓存相关表的「无用索引」清理清单：table -> {不再需要索引的列名}
# 依据：全代码 grep 确认这些列从不作为精确查询条件（或仅 LIKE '%x%' 用不上索引），
# 保留索引纯属写放大。DROP INDEX 可逆（删错重建即可，不丢数据），风险低。
_UNUSED_INDEX_COLUMNS = {
    "api_response_cache": {
        "source", "method", "status_code", "body_hash", "request_body_hash",
        "redis_key", "storage_mode", "last_used_at", "last_refresh_at", "client_ip",
    },
    "api_cache_access_logs": {
        "cache_key", "api_path", "worker_request_id",
    },
    "api_response_entities": {
        "title", "api_path", "cache_key",
    },
    "episode_links": {
        "local_title", "season_number", "episode_number", "file_name_hash",
        "source_cache_key", "bangumi_cache_key", "comment_cache_key",
        "verified_by_user_id",
    },
}


def _patch_drop_unused_indexes(engine: Engine) -> bool:
    """删除缓存相关表上从不用于查询的冗余单列索引，降低写放大。

    幂等：用 inspector 读实际索引，只删「单列且该列在清理清单内」的索引；
    索引不存在则跳过。unique 约束索引一律不动（保证唯一性）。
    单表失败不影响其它表。
    """
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    changed = False

    for table, drop_cols in _UNUSED_INDEX_COLUMNS.items():
        if table not in table_names:
            continue
        try:
            indexes = inspector.get_indexes(table)
        except Exception as e:
            logger.warning(f"⚠️ 读取 {table} 索引失败，跳过: {e}")
            continue
        for idx in indexes:
            cols = idx.get("column_names") or []
            name = idx.get("name")
            # 只处理单列、非唯一、且列名在清理清单内的索引
            if idx.get("unique"):
                continue
            if len(cols) != 1 or cols[0] not in drop_cols or not name:
                continue
            try:
                with engine.begin() as conn:
                    # 反引号包裹索引名，兼容 MySQL；SQLite/PG 也接受标准 DROP INDEX
                    dialect = engine.dialect.name
                    if dialect == "mysql":
                        conn.exec_driver_sql(f"DROP INDEX `{name}` ON `{table}`")
                    else:
                        conn.exec_driver_sql(f'DROP INDEX IF EXISTS "{name}"')
                logger.info(f"🗑️ 已删除冗余索引 {table}.{name}（列={cols[0]}）")
                changed = True
            except Exception as e:
                logger.warning(f"⚠️ 删除索引 {table}.{name} 失败（跳过）: {e}")
    return changed


def _patch_drop_sign_zombie_columns(engine: Engine) -> bool:
    """删除签名重构遗留的僵尸 NOT NULL 列，避免新版插入违反旧约束导致 500。

    - sign_key_pool.auth_ua_keys：旧「签名组绑UA」设计的列，NOT NULL，新版不再写入
    - ua_limit_rules.sign_required：旧布尔开关，已被 sign_group_id 取代
    仅当列存在时才 DROP（幂等）；DROP COLUMN 需 SQLite 3.35+ / MySQL / PG 均支持。
    """
    inspector = inspect(engine)
    targets = {
        "sign_key_pool": "auth_ua_keys",
        "ua_limit_rules": "sign_required",
    }
    changed = False
    tables = set(inspector.get_table_names())
    for table, col in targets.items():
        if table not in tables:
            continue
        cols = {c["name"] for c in inspector.get_columns(table)}
        if col not in cols:
            continue
        try:
            with engine.begin() as conn:
                if engine.dialect.name == "mysql":
                    conn.exec_driver_sql(f"ALTER TABLE `{table}` DROP COLUMN `{col}`")
                else:
                    conn.exec_driver_sql(f'ALTER TABLE "{table}" DROP COLUMN "{col}"')
            logger.info(f"🗑️ 已删除签名僵尸列 {table}.{col}")
            changed = True
        except Exception as e:
            logger.warning(f"⚠️ 删除僵尸列 {table}.{col} 失败（跳过，不影响启动）: {e}")
    return changed


# ============ 补丁注册表 ============
# 按顺序执行；新增补丁在此登记即生效。
_PATCHES: List[Callable[[Engine], bool]] = [
    _patch_example_noop,
    _patch_drop_unused_indexes,
    _patch_drop_sign_zombie_columns,
]


def apply_patches(engine: Engine) -> dict:
    """补丁入口：依次执行所有已注册补丁（幂等、互不影响）。

    在「create_all 建表」与「SchemaGuard 自动补列」之后调用。
    单个补丁失败只记录日志，不中断启动，也不影响其它补丁。

    返回 { applied:[执行了变更的补丁名], failed:[失败的补丁名] }
    """
    applied: List[str] = []
    failed: List[str] = []
    for patch in _PATCHES:
        name = patch.__name__
        try:
            changed = patch(engine)
            if changed:
                applied.append(name)
                logger.info(f"🩹 补丁已应用: {name}")
        except Exception as e:
            failed.append(name)
            logger.error(f"❌ 补丁执行失败（跳过，不影响启动）: {name}: {e}")

    if applied:
        logger.info(f"✅ 数据库补丁完成，本次应用 {len(applied)} 个: {', '.join(applied)}")
    else:
        logger.info("✅ 数据库补丁检查完成，无需应用")
    if failed:
        logger.error(f"🛑 有 {len(failed)} 个补丁失败，请人工排查: {', '.join(failed)}")
    return {"applied": applied, "failed": failed}
