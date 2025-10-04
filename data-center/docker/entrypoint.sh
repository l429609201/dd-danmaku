#!/bin/sh
set -e

# 如果环境变量未设置，则使用默认值
PUID=${PUID:-1000}
PGID=${PGID:-1000}
UMASK=${UMASK:-0022}

echo "🔧 设置用户权限: PUID=$PUID, PGID=$PGID, UMASK=$UMASK"

# 设置 umask
umask ${UMASK}

# 确保配置目录存在
mkdir -p /app/config /app/config/logs /app/config/backups

# 更新挂载目录的所有权，以确保容器内的用户有权写入
echo "🔧 正在更新 /app/config 目录的所有权为 ${PUID}:${PGID}..."
chown -R ${PUID}:${PGID} /app/config

# 确保数据库目录有写权限（SQLite需要在目录中创建临时文件）
chmod 775 /app/config

# 如果数据库文件存在，确保有写权限
if [ -f "/app/config/database.db" ]; then
    chown ${PUID}:${PGID} /app/config/database.db
    chmod 664 /app/config/database.db
fi

echo "✅ 权限设置完成，启动应用..."

# 使用 su-exec 工具切换到指定的 UID/GID，并执行应用
exec su-exec ${PUID}:${PGID} uvicorn src.main:app --host 0.0.0.0 --port 7759 --workers 1
