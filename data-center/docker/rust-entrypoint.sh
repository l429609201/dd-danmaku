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

# 修改用户和组ID（如果需要）
if [ "$PUID" != "1000" ] || [ "$PGID" != "1000" ]; then
    echo "Adjusting user/group IDs..."
    
    # 修改组ID
    if [ "$PGID" != "1000" ]; then
        delgroup appgroup 2>/dev/null || true
        addgroup -g "$PGID" appgroup
    fi
    
    # 修改用户ID
    if [ "$PUID" != "1000" ]; then
        deluser appuser 2>/dev/null || true
        adduser -u "$PUID" -G appgroup -s /bin/sh -D appuser
    fi
    
    # 修复文件权限
    chown -R appuser:appgroup /app/config 2>/dev/null || true
fi

# 设置 umask
umask "$UMASK"

# 确保必要目录存在
mkdir -p /app/config/logs
mkdir -p /app/config/danmaku
chown -R appuser:appgroup /app/config

# 打印配置信息
echo ""
echo "Configuration:"
echo "  Database: ${DATABASE_URL:-sqlite://app/config/database.db}"
echo "  Log level: ${RUST_LOG:-info}"
echo "  Port: ${PORT:-7759}"
echo "  Danmaku store: ${DANMAKU_STORE_DIR:-/app/config/danmaku}"
echo ""

# 切换到普通用户并执行应用
echo "Starting server as user 'appuser'..."
exec su-exec appuser "$@"
