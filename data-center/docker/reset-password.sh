#!/bin/sh
# 密码重置脚本 - 在容器外使用
# 用法：
#   ./reset-password.sh <username> [new_password]
#
# 示例：
#   ./reset-password.sh admin
#   ./reset-password.sh admin MyNewPass123

CONTAINER_NAME="danmu-data-center"

# 检查参数
if [ $# -lt 1 ]; then
    echo "用法: $0 <username> [new_password]"
    echo ""
    echo "示例:"
    echo "  $0 admin"
    echo "  $0 admin MyNewPass123"
    exit 1
fi

USERNAME=$1
NEW_PASSWORD=$2

# 检查容器是否运行
if ! docker ps | grep -q "$CONTAINER_NAME"; then
    echo "❌ 容器未运行: $CONTAINER_NAME"
    echo "请先启动容器: docker-compose up -d"
    exit 1
fi

echo "🔄 正在重置密码..."
echo ""

# 执行密码重置
if [ -z "$NEW_PASSWORD" ]; then
    # 没有提供密码，生成随机密码
    docker exec -it "$CONTAINER_NAME" python -m src.utils.reset_password "$USERNAME"
else
    # 使用提供的密码
    docker exec -it "$CONTAINER_NAME" python -m src.utils.reset_password "$USERNAME" "$NEW_PASSWORD"
fi

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✅ 密码重置完成！"
else
    echo ""
    echo "❌ 密码重置失败，请检查日志"
fi

exit $EXIT_CODE

