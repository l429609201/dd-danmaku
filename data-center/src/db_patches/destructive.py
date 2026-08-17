"""不可逆数据库补丁；默认不进入自动启动路径。"""
import logging

from sqlalchemy import inspect
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)



def drop_sign_zombie_columns(engine: Engine) -> bool:
    """删除签名重构遗留列；注册为不可逆补丁，默认不执行。"""
    targets = {
        "sign_key_pool": "auth_ua_keys",
        "ua_limit_rules": "sign_required",
    }
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    pending = []
    for table, column in targets.items():
        if table not in tables:
            continue
        columns = {item["name"] for item in inspector.get_columns(table)}
        if column in columns:
            pending.append((table, column))
    if not pending:
        return False

    logger.warning("⚠️ 即将删除签名重构遗留列: %s", pending)
    with engine.begin() as conn:
        for table, column in pending:
            if engine.dialect.name == "mysql":
                conn.exec_driver_sql(
                    f"ALTER TABLE `{table}` DROP COLUMN `{column}`")
            else:
                conn.exec_driver_sql(
                    f'ALTER TABLE "{table}" DROP COLUMN "{column}"')
    return True


def drop_worker_request_logs(engine: Engine) -> bool:
    """删除已停写的旧 Worker 明细表。

    执行前应先人工确认轮转文件正常，并按需使用 mysqldump 备份旧表。
    """
    table = "worker_request_logs"
    inspector = inspect(engine)
    if table not in set(inspector.get_table_names()):
        return False

    logger.warning(
        "⚠️ 即将执行不可逆删表 %s；请确认历史数据已备份", table)
    dialect = engine.dialect.name
    with engine.begin() as conn:
        for index in inspector.get_indexes(table):
            name = index.get("name")
            if not name:
                continue
            try:
                if dialect == "mysql":
                    conn.exec_driver_sql(f"DROP INDEX `{name}` ON `{table}`")
                else:
                    conn.exec_driver_sql(f'DROP INDEX IF EXISTS "{name}"')
            except Exception:
                # DROP TABLE 本身会移除索引；索引预清理失败不阻断删表。
                logger.warning("⚠️ 预删除索引失败，继续删表: %s.%s", table, name)
        if dialect == "mysql":
            conn.exec_driver_sql(f"DROP TABLE IF EXISTS `{table}`")
        else:
            conn.exec_driver_sql(f'DROP TABLE IF EXISTS "{table}"')
    logger.info("🗑️ 已删除停写表 %s", table)
    return True
