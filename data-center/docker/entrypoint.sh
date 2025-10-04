#!/bin/sh

# 确保配置目录存在并有正确权限
mkdir -p /app/config /app/config/logs /app/config/backups
chmod -R 755 /app/config

# 如果数据库文件存在，确保有写权限
if [ -f "/app/config/database.db" ]; then
    chmod 664 /app/config/database.db
fi

# 启动应用
exec uvicorn src.main:app --host 0.0.0.0 --port 7759 --workers 1
