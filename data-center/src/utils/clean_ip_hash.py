#!/usr/bin/env python3
"""
响应缓存历史 client_ip_hash 旧列清理工具

背景：响应缓存已改为记录明文 client_ip，旧的 client_ip_hash 列不再使用。
本脚本清理该遗留列，避免历史哈希数据滞留。

用法（在 data-center 目录下执行）：
  python -m src.utils.clean_ip_hash            # 默认：把旧列数据置空（安全、通用）
  python -m src.utils.clean_ip_hash --drop     # 彻底删除旧列（SQLite 需 3.35+；MySQL/PG 支持）

涉及表：api_response_cache、api_cache_access_logs
说明：明文 client_ip 列不受影响；仅处理 client_ip_hash 旧列。
"""
import sys

# 容器内路径兜底；本地在 data-center 目录直接 -m 运行亦可
sys.path.insert(0, "/app")

from sqlalchemy import inspect, text

from src.database import engine

# 需要处理的表（旧列统一为 client_ip_hash）
TARGET_TABLES = ["api_response_cache", "api_cache_access_logs"]
OLD_COLUMN = "client_ip_hash"


def _tables_with_old_column():
    """返回当前库中仍存在 client_ip_hash 旧列的目标表"""
    inspector = inspect(engine)
    existing = set(inspector.get_table_names())
    hit = []
    for tbl in TARGET_TABLES:
        if tbl not in existing:
            continue
        cols = {c["name"] for c in inspector.get_columns(tbl)}
        if OLD_COLUMN in cols:
            hit.append(tbl)
    return hit


def clear_data(tables):
    """把旧列数据置空（保留列结构，最通用、最安全）"""
    for tbl in tables:
        with engine.begin() as conn:
            result = conn.execute(text(
                f"UPDATE {tbl} SET {OLD_COLUMN} = NULL "
                f"WHERE {OLD_COLUMN} IS NOT NULL"
            ))
            print(f"✅ 已清空 {tbl}.{OLD_COLUMN} 数据（影响 {result.rowcount} 行）")


def drop_column(tables):
    """彻底删除旧列；老版本 SQLite 不支持 DROP COLUMN 时回退为清空数据"""
    for tbl in tables:
        try:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {tbl} DROP COLUMN {OLD_COLUMN}"))
            print(f"✅ 已删除列 {tbl}.{OLD_COLUMN}")
        except Exception as e:
            print(f"⚠️ 删除 {tbl}.{OLD_COLUMN} 失败（{e}）；回退为清空数据")
            clear_data([tbl])


def main():
    drop = "--drop" in sys.argv[1:]
    tables = _tables_with_old_column()
    if not tables:
        print("ℹ️ 未发现 client_ip_hash 旧列，无需处理")
        return 0

    print(f"🔄 待处理表: {', '.join(tables)}（模式: {'删除列' if drop else '清空数据'}）")
    if drop:
        drop_column(tables)
    else:
        clear_data(tables)
    print("🎉 处理完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
