#!/bin/sh
set -e

# Rust 后端启动脚本
# 处理权限和用户切换

echo "====================================="
echo "dd-danmaku Data Center (Rust)"
echo "====================================="

# 获取环境变量（带默认值）
PUID=${PUID:-1000}
PGID=${PGID:-1000}
UMASK=${UMASK:-0022}

echo "Starting with PUID=$PUID, PGID=$PGID, UMASK=$UMASK"

# 将容器内专用执行用户映射到宿主传入的 UID/GID，不仅仅以裸数字启动。
case "$PUID" in ''|*[!0-9]*) echo "PUID 必须为非负整数" >&2; exit 1;; esac
case "$PGID" in ''|*[!0-9]*) echo "PGID 必须为非负整数" >&2; exit 1;; esac
# 镜像预建 danmuku-rust/danmuku-rust；-o 允许目标数字身份已存在，避免删除系统账号。
# 同时设置主组，确保仅调整 PGID 时执行用户也使用新的组权限。
groupmod -o -g "$PGID" danmuku-rust
usermod -o -u "$PUID" -g danmuku-rust danmuku-rust
export HOME=/home/danmuku-rust
mkdir -p "$HOME"
chown "$PUID:$PGID" "$HOME"
CONFIG_PATH=${CONFIG_PATH:-/app/config}
export CONFIG_PATH

# 设置 umask
umask "$UMASK"

# 确保必要目录存在
mkdir -p "$CONFIG_PATH/logs" "$CONFIG_PATH/danmaku"
# 启动前修正持久化目录所有权；主密钥仍由程序以 0600 创建，不受 UMASK 放宽。
chown -R "$PUID:$PGID" "$CONFIG_PATH"

# 打印配置信息
echo ""
echo "Configuration:"
echo "  Database: ${DATABASE_URL:-sqlite://app/config/database.db}"
echo "  Log level: ${RUST_LOG:-info}"
echo "  Port: ${PORT:-7759}"
echo "  Danmaku store: ${DANMAKU_STORE_DIR:-/app/config/danmaku}"
echo ""

# 切换到普通用户并执行应用
echo "Starting server as danmuku-rust (UID=$PUID GID=$PGID)..."
exec su-exec danmuku-rust:danmuku-rust "$@"
