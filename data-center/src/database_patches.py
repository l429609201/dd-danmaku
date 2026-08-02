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


def _patch_widen_client_user_id(engine: Engine) -> bool:
    """扩宽 worker_request_logs.client_user_id 到 255。

    背景：该列原为 varchar(64)，够存 Emby 原生用户 ID（32/36 字符）。
    但客户端改为上报**混淆后**的用户标识后长度翻倍——
    `misaka10876:` + 36 位 GUID = 48 字节，hex 编码后 96 字符，超出 64。
    结果整批日志落库失败（DataError 1406 Data too long），
    连校验失败的日志也写不进去，直接导致排查时"看不到任何校验记录"。

    仅当现有长度 < 255 时才 ALTER（幂等）。SQLite 无需处理：
    它的 VARCHAR 不强制长度，本身不会报此错。
    """
    inspector = inspect(engine)
    if "worker_request_logs" not in set(inspector.get_table_names()):
        return False
    dialect = engine.dialect.name
    if dialect == "sqlite":
        return False  # SQLite 不限制 varchar 长度，无需变更

    col = next((c for c in inspector.get_columns("worker_request_logs")
                if c["name"] == "client_user_id"), None)
    if col is None:
        return False
    # 取现有长度；拿不到长度信息时保守跳过，避免无谓 ALTER
    length = getattr(col.get("type"), "length", None)
    if length is None or length >= 255:
        return False

    try:
        with engine.begin() as conn:
            if dialect == "mysql":
                conn.exec_driver_sql(
                    "ALTER TABLE `worker_request_logs` "
                    "MODIFY COLUMN `client_user_id` VARCHAR(255) NULL"
                )
            else:  # PostgreSQL
                conn.exec_driver_sql(
                    'ALTER TABLE "worker_request_logs" '
                    'ALTER COLUMN "client_user_id" TYPE VARCHAR(255)'
                )
        logger.info(f"📏 已扩宽 worker_request_logs.client_user_id: {length} → 255")
        return True
    except Exception as e:
        logger.warning(f"⚠️ 扩宽 client_user_id 失败（跳过，不影响启动）: {e}")
        return False


def _patch_widen_cache_response_body(engine: Engine) -> bool:
    """把 api_response_cache.response_body 从 TEXT 扩到 MEDIUMTEXT。

    背景：TEXT 上限 64 KB，而搜索类接口（如 /api/v2/search/episodes 返回
    大量剧集）的响应体常常超过，导致
      cache.upsert 失败: (1406) Data too long for column 'response_body'
    该列是 Redis 的 SQL 冷备，写失败虽不影响当次响应，但 Redis 淘汰/重启后
    缓存会变成空壳，等于该接口永久无法命中缓存、每次都回源。
    MEDIUMTEXT 上限 16 MB，足够覆盖。SQLite 无长度限制，跳过。
    """
    inspector = inspect(engine)
    if "api_response_cache" not in set(inspector.get_table_names()):
        return False
    dialect = engine.dialect.name
    if dialect != "mysql":
        # PostgreSQL 的 text 本身无长度上限；SQLite 同理，均无需变更
        return False
    try:
        with engine.begin() as conn:
            cur = conn.exec_driver_sql(
                "SELECT DATA_TYPE FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'api_response_cache' "
                "AND COLUMN_NAME = 'response_body'"
            ).fetchone()
            if not cur or str(cur[0]).lower() != "text":
                return False  # 已是 mediumtext/longtext，无需处理
            conn.exec_driver_sql(
                "ALTER TABLE `api_response_cache` "
                "MODIFY COLUMN `response_body` MEDIUMTEXT NULL"
            )
        logger.info("📏 已扩宽 api_response_cache.response_body: TEXT → MEDIUMTEXT")
        return True
    except Exception as e:
        logger.warning(f"⚠️ 扩宽 response_body 失败（跳过，不影响启动）: {e}")
        return False


# ============ 复合索引：按"过滤列 + 排序列"建，让分页查询能走索引 ============
# 背景：列表接口普遍是「WHERE 某列 = ? ORDER BY 时间 DESC LIMIT n」。
# 只有单列索引时，MySQL 用 A 列索引过滤后仍需额外排序（filesort），
# 数据量大时排序开销占主导。加 (过滤列, 时间列) 复合索引后，
# 索引本身已按时间有序，可直接边扫边取前 n 条，避免 filesort。
#
# 命名统一 ix_<表>_<列缩写>，便于识别与回滚。
_COMPOSITE_INDEXES = {
    "worker_request_logs": [
        # 按级别筛选 + 时间倒序（日志页最常用组合）
        ("ix_wrl_level_created", ["level", "created_at"]),
        # 按 worker 筛选 + 时间倒序
        ("ix_wrl_worker_created", ["worker_id", "created_at"]),
        # 按状态码筛选 + 时间倒序（排查错误请求）
        ("ix_wrl_status_created", ["status", "created_at"]),
    ],
    "api_cache_access_logs": [
        # 按访问类型筛选 + 时间倒序（命中率统计与趋势聚合都走这个）
        ("ix_acal_type_created", ["access_type", "created_at"]),
    ],
    "api_response_cache": [
        # 待刷新筛选 + 获取时间倒序
        ("ix_arc_pending_fetched", ["refresh_pending", "fetched_at"]),
        # 空结果负缓存分页：is_empty 过滤 + 时间倒序
        ("ix_arc_empty_fetched", ["is_empty", "fetched_at"]),
    ],
    "ip_request_stats_current": [
        # IP 统计页：时间范围过滤 + 按请求量/违规数排序
        ("ix_irsc_last_total", ["last_access_at", "total_count"]),
    ],
    "worker_metrics_snapshot": [
        # 指标趋势：按 worker + 快照时间聚合
        ("ix_wms_worker_snapshot", ["worker_id", "snapshot_at"]),
    ],
    "ip_rules": [
        # 配置下发按「启用 且 未过期」过滤，单列 enabled 索引区分度极低
        # （几乎全部 enabled=true），复合索引才能真正缩小扫描范围
        ("ix_ip_rules_enabled_expires", ["enabled", "expires_at"]),
        # 清理任务按 created_by + expires_at 找过期的自动封禁记录
        ("ix_ip_rules_createdby_expires", ["created_by", "expires_at"]),
    ],
    "api_response_entities": [
        # 实体列表：类型过滤 + 最近出现时间倒序
        ("ix_are_type_lastseen", ["entity_type", "last_seen_at"]),
        # 「从零拼整」主查询路径：按番剧取整季 / 按番剧+集号取单集
        ("ix_are_anime_ep", ["entity_type", "anime_id", "episode_number"]),
        # 按标题反查 animeId（search 关键词匹配入口）
        ("ix_are_type_title", ["entity_type", "title"]),
    ],
}


def _patch_add_composite_indexes(engine: Engine) -> bool:
    """为大表补「过滤列 + 时间列」复合索引，消除分页查询的 filesort。

    幂等：
    - 表不存在则跳过；
    - 目标列不全存在则跳过（避免因模型演进导致建索引失败）；
    - 已存在同名索引，或已存在「列序完全相同」的索引则跳过。
    单个索引失败不影响其它索引与启动流程。
    """
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    dialect = engine.dialect.name
    changed = False

    for table, specs in _COMPOSITE_INDEXES.items():
        if table not in tables:
            continue
        try:
            existing = inspector.get_indexes(table)
            table_cols = {c["name"] for c in inspector.get_columns(table)}
        except Exception as e:
            logger.warning(f"⚠️ 读取 {table} 结构失败，跳过复合索引: {e}")
            continue

        existing_names = {idx.get("name") for idx in existing}
        # 已有索引的列序集合，用于判断"等价索引已存在"
        existing_colsets = {tuple(idx.get("column_names") or []) for idx in existing}

        for name, cols in specs:
            if name in existing_names:
                continue
            if tuple(cols) in existing_colsets:
                continue
            # 列不全（模型尚未升级/列已删）则跳过，不报错
            if not set(cols).issubset(table_cols):
                continue
            try:
                with engine.begin() as conn:
                    if dialect == "mysql":
                        col_sql = ", ".join(f"`{c}`" for c in cols)
                        conn.exec_driver_sql(
                            f"CREATE INDEX `{name}` ON `{table}` ({col_sql})"
                        )
                    else:
                        col_sql = ", ".join(f'"{c}"' for c in cols)
                        conn.exec_driver_sql(
                            f'CREATE INDEX IF NOT EXISTS "{name}" ON "{table}" ({col_sql})'
                        )
                logger.info(f"📈 已创建复合索引 {table}.{name}（{', '.join(cols)}）")
                changed = True
            except Exception as e:
                logger.warning(f"⚠️ 创建复合索引 {table}.{name} 失败（跳过）: {e}")
    return changed


def _patch_entity_unique_key(engine: Engine) -> bool:
    """为 api_response_entities 建 (entity_type, entity_id) 唯一约束。

    该表是「化整为零」的落点，业务上 (type, id) 必须唯一，
    原先只有两个独立普通索引，并发 upsert 有产生重复行的空隙。

    单独成一个补丁而不并入 _COMPOSITE_INDEXES，是因为建唯一约束前
    **必须先去重**：存量若已有重复行，CREATE UNIQUE INDEX 会直接失败。
    去重保留 id 最小的行（first_seen_at 最早，raw_json 由后续 upsert 覆盖）。

    幂等：表不存在 / 已有等价唯一索引则跳过。
    """
    table = "api_response_entities"
    cols = ("entity_type", "entity_id")
    inspector = inspect(engine)
    if table not in set(inspector.get_table_names()):
        return False
    try:
        existing = inspector.get_indexes(table)
        table_cols = {c["name"] for c in inspector.get_columns(table)}
    except Exception as e:
        logger.warning(f"⚠️ 读取 {table} 结构失败，跳过唯一约束: {e}")
        return False
    if not set(cols).issubset(table_cols):
        return False
    # 已存在「列序相同且 unique」的索引则视为已完成
    for idx in existing:
        if tuple(idx.get("column_names") or []) == cols and idx.get("unique"):
            return False
    if "uq_are_type_id" in {idx.get("name") for idx in existing}:
        return False

    dialect = engine.dialect.name
    try:
        with engine.begin() as conn:
            # 先去重：按 (entity_type, entity_id) 分组，只保留最小 id
            dup_sql = (
                f"DELETE FROM {table} WHERE id NOT IN ("
                f"  SELECT keep_id FROM ("
                f"    SELECT MIN(id) AS keep_id FROM {table}"
                f"    GROUP BY entity_type, entity_id"
                f"  ) AS t"
                f")"
            )
            result = conn.exec_driver_sql(dup_sql)
            removed = result.rowcount or 0
            if removed > 0:
                logger.info(f"🧹 {table} 去重完成，删除 {removed} 行重复实体")
            if dialect == "mysql":
                conn.exec_driver_sql(
                    f"CREATE UNIQUE INDEX `uq_are_type_id` ON `{table}` "
                    f"(`entity_type`, `entity_id`)"
                )
            else:
                conn.exec_driver_sql(
                    f'CREATE UNIQUE INDEX IF NOT EXISTS "uq_are_type_id" '
                    f'ON "{table}" ("entity_type", "entity_id")'
                )
        logger.info(f"🔑 已创建唯一约束 {table}.uq_are_type_id")
        return True
    except Exception as e:
        logger.warning(f"⚠️ 创建 {table} 唯一约束失败（跳过）: {e}")
        return False


def _patch_backfill_entity_anime_ep(engine: Engine) -> bool:
    """回填 api_response_entities 存量 episode 行的 anime_id / episode_number。

    存量 10 万+ episode 行是在加列之前写入的，两列全空，
    「从零拼整」查不到任何数据。好在 raw_json 里本来就带 episodeNumber，
    可以纯 SQL 回填，无需重新回源。

    - episode_number：从 raw_json 取 episodeNumber
    - anime_id：按 title 关联同表的 anime/bangumi 实体反查
      （比截取 episodeId 前缀可靠——集号位数不固定）

    幂等：只更新目标列为 NULL 的行；全部已回填则不做事。
    仅 MySQL / SQLite 走各自的 JSON 提取语法，其它方言跳过（不报错）。
    """
    table = "api_response_entities"
    inspector = inspect(engine)
    if table not in set(inspector.get_table_names()):
        return False
    try:
        table_cols = {c["name"] for c in inspector.get_columns(table)}
    except Exception as e:
        logger.warning(f"⚠️ 读取 {table} 结构失败，跳过回填: {e}")
        return False
    if not {"anime_id", "episode_number"}.issubset(table_cols):
        return False

    dialect = engine.dialect.name
    if dialect == "mysql":
        json_expr = "JSON_UNQUOTE(JSON_EXTRACT(raw_json, '$.episodeNumber'))"
    elif dialect == "sqlite":
        json_expr = "json_extract(raw_json, '$.episodeNumber')"
    else:
        return False

    changed = False
    try:
        # 先看有没有待回填的行，避免每次启动都跑全表 UPDATE
        with engine.connect() as conn:
            pending = conn.exec_driver_sql(
                f"SELECT COUNT(*) FROM {table} WHERE entity_type = 'episode' "
                f"AND (anime_id IS NULL OR episode_number IS NULL)"
            ).scalar() or 0
        if pending == 0:
            return False

        logger.info(f"🔄 开始回填 {table} 的 anime_id/episode_number（待处理 {pending} 行）")
        with engine.begin() as conn:
            r1 = conn.exec_driver_sql(
                f"UPDATE {table} SET episode_number = {json_expr} "
                f"WHERE entity_type = 'episode' AND episode_number IS NULL "
                f"AND {json_expr} IS NOT NULL"
            )
            logger.info(f"  ├─ episode_number 回填 {r1.rowcount or 0} 行")

        # anime_id 用自关联子查询：按 title 找同名 anime/bangumi 实体。
        # 同名可能匹配到多个（不同季同名较少但存在），取 MIN 保证确定性。
        with engine.begin() as conn:
            if dialect == "mysql":
                # MySQL 不允许 UPDATE 时直接子查询同一张表，套一层派生表绕过
                r2 = conn.exec_driver_sql(
                    f"UPDATE {table} e JOIN ("
                    f"  SELECT title, MIN(entity_id) AS aid FROM {table}"
                    f"  WHERE entity_type IN ('anime','bangumi') AND title IS NOT NULL"
                    f"  GROUP BY title"
                    f") m ON e.title = m.title "
                    f"SET e.anime_id = m.aid "
                    f"WHERE e.entity_type = 'episode' AND e.anime_id IS NULL"
                )
            else:
                r2 = conn.exec_driver_sql(
                    f"UPDATE {table} SET anime_id = ("
                    f"  SELECT MIN(a.entity_id) FROM {table} a"
                    f"  WHERE a.entity_type IN ('anime','bangumi')"
                    f"    AND a.title = {table}.title"
                    f") WHERE entity_type = 'episode' AND anime_id IS NULL"
                )
            logger.info(f"  └─ anime_id 回填 {r2.rowcount or 0} 行")
        changed = True
    except Exception as e:
        logger.warning(f"⚠️ 回填 {table} 失败（跳过，不影响启动）: {e}")
    return changed


# ============ 补丁注册表 ============
# 按顺序执行；新增补丁在此登记即生效。
_PATCHES: List[Callable[[Engine], bool]] = [
    _patch_example_noop,
    _patch_drop_unused_indexes,
    _patch_drop_sign_zombie_columns,
    _patch_widen_client_user_id,
    _patch_widen_cache_response_body,
    _patch_add_composite_indexes,
    _patch_entity_unique_key,
    # 回填放在建索引之后：先有 ix_are_anime_ep，UPDATE 的 WHERE 才走索引
    _patch_backfill_entity_anime_ep,
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
