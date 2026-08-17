"""数据库补丁执行器：用历史表跳过已完成的一次性补丁。"""
import logging
from typing import Iterable

from sqlalchemy import text
from sqlalchemy.engine import Engine

from src.db_patches.types import Patch

logger = logging.getLogger(__name__)
_HISTORY_TABLE = "schema_patch_history"


def _ensure_history_table(engine: Engine) -> None:
    """自举补丁历史表；只包含运行器需要的最小字段。"""
    if engine.dialect.name == "mysql":
        ddl = f"""
        CREATE TABLE IF NOT EXISTS `{_HISTORY_TABLE}` (
            `patch_id` VARCHAR(120) PRIMARY KEY,
            `description` VARCHAR(500) NOT NULL,
            `changed` BOOLEAN NOT NULL DEFAULT 0,
            `applied_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    else:
        ddl = f"""
        CREATE TABLE IF NOT EXISTS \"{_HISTORY_TABLE}\" (
            \"patch_id\" VARCHAR(120) PRIMARY KEY,
            \"description\" VARCHAR(500) NOT NULL,
            \"changed\" BOOLEAN NOT NULL DEFAULT 0,
            \"applied_at\" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    with engine.begin() as conn:
        conn.exec_driver_sql(ddl)


def _completed_ids(engine: Engine) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(text(
            f"SELECT patch_id FROM {_HISTORY_TABLE}"
        )).scalars().all()
    return set(rows)


def _record_completed(engine: Engine, patch: Patch, changed: bool) -> None:
    with engine.begin() as conn:
        conn.execute(text(
            f"INSERT INTO {_HISTORY_TABLE} "
            "(patch_id, description, changed) "
            "VALUES (:patch_id, :description, :changed)"
        ), {
            "patch_id": patch.patch_id,
            "description": patch.description,
            "changed": bool(changed),
        })


def apply_patch_registry(
    engine: Engine,
    patches: Iterable[Patch],
    allow_destructive: bool = False,
) -> dict:
    """执行未完成补丁；失败不记历史，保证下次启动可重试。"""
    _ensure_history_table(engine)
    completed = _completed_ids(engine)
    applied, skipped, failed = [], [], []

    for patch in patches:
        if patch.patch_id in completed:
            skipped.append(patch.patch_id)
            continue
        if patch.destructive and not allow_destructive:
            logger.warning(
                "⚠️ 不可逆补丁默认关闭，需显式开启后执行: %s（%s）",
                patch.patch_id, patch.description,
            )
            skipped.append(patch.patch_id)
            continue
        try:
            changed = bool(patch.apply(engine))
            _record_completed(engine, patch, changed)
            applied.append(patch.patch_id)
            logger.info(
                "🩹 补丁已完成: %s（%s）", patch.patch_id,
                "已变更" if changed else "无需变更",
            )
        except Exception as exc:
            failed.append(patch.patch_id)
            logger.error("❌ 补丁执行失败，将在下次启动重试: %s: %s", patch.patch_id, exc)

    logger.info(
        "✅ 数据库补丁检查完成：本次完成 %d，跳过 %d，失败 %d",
        len(applied), len(skipped), len(failed),
    )
    return {"applied": applied, "skipped": skipped, "failed": failed}
