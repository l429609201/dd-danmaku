#!/bin/bash
# data-center Rust 后端快速启动脚本

set -e

# 默认配置
DATABASE_URL="${DATABASE_URL:-sqlite:/app/data/database.db}"
LISTEN_ADDR="${LISTEN_ADDR:-0.0.0.0:7759}"
RUST_LOG="${RUST_LOG:-info,sqlx=warn}"

echo "=== data-center Rust Backend ==="
echo "Database: $DATABASE_URL"
echo "Listen: $LISTEN_ADDR"
echo "Log Level: $RUST_LOG"
echo "================================"

# 创建数据目录（如果是 SQLite）
if [[ "$DATABASE_URL" == sqlite:* ]]; then
    DB_DIR=$(dirname "${DATABASE_URL#sqlite:}")
    mkdir -p "$DB_DIR"
    echo "Created database directory: $DB_DIR"
fi

# 启动服务器
exec /app/server
