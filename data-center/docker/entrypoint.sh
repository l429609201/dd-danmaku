#!/bin/sh

# 设置默认值
PUID=${PUID:-1000}
PGID=${PGID:-1000}

echo "🔧 设置用户权限: PUID=$PUID, PGID=$PGID"

# 修改用户和组ID
if [ "$PUID" != "1000" ] || [ "$PGID" != "1000" ]; then
    echo "🔧 调整用户ID和组ID..."

    # 修改组ID
    if [ "$PGID" != "1000" ]; then
        groupmod -g "$PGID" appgroup
    fi

    # 修改用户ID
    if [ "$PUID" != "1000" ]; then
        usermod -u "$PUID" appuser
    fi
fi

# 确保配置目录存在并有正确权限
mkdir -p /app/config /app/config/logs /app/config/backups
chown -R appuser:appgroup /app/config
chmod -R 755 /app/config

# 如果数据库文件存在，确保有写权限
if [ -f "/app/config/database.db" ]; then
    chown appuser:appgroup /app/config/database.db
    chmod 664 /app/config/database.db
fi

# 确保数据库目录有写权限（SQLite需要在目录中创建临时文件）
chmod 775 /app/config

echo "✅ 权限设置完成，启动应用..."

# 切换到指定用户启动应用
exec su-exec appuser uvicorn src.main:app --host 0.0.0.0 --port 7759 --workers 1
