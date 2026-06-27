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


# ============ 补丁注册表 ============
# 按顺序执行；新增补丁在此登记即生效。
_PATCHES: List[Callable[[Engine], bool]] = [
    _patch_example_noop,
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
