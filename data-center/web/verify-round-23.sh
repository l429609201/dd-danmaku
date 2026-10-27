#!/bin/bash
# Phase 6 Round 23 验证脚本
# 自动化安装依赖并启动开发服务器

set -e

echo "======================================"
echo "Phase 6 Round 23 验证脚本"
echo "======================================"
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 项目路径
PROJECT_DIR="/home/root_nas/项目/dd-danmaku/data-center/web"

echo -e "${YELLOW}步骤 1/5: 检查目录${NC}"
if [ ! -d "$PROJECT_DIR" ]; then
    echo -e "${RED}错误：项目目录不存在${NC}"
    exit 1
fi
cd "$PROJECT_DIR"
echo -e "${GREEN}✓ 目录检查通过${NC}"
echo ""

echo -e "${YELLOW}步骤 2/5: 清理旧依赖${NC}"
if [ -d "node_modules" ]; then
    echo "删除 node_modules..."
    rm -rf node_modules
fi
if [ -f "package-lock.json" ]; then
    echo "删除 package-lock.json..."
    rm -f package-lock.json
fi
echo -e "${GREEN}✓ 清理完成${NC}"
echo ""

echo -e "${YELLOW}步骤 3/5: 安装依赖${NC}"
echo "这可能需要几分钟..."
npm install
echo -e "${GREEN}✓ 依赖安装完成${NC}"
echo ""

echo -e "${YELLOW}步骤 4/5: 修复权限${NC}"
if [ -d "node_modules/.bin" ]; then
    chmod +x node_modules/.bin/*
    echo -e "${GREEN}✓ 权限修复完成${NC}"
else
    echo -e "${RED}警告：node_modules/.bin 不存在${NC}"
fi
echo ""

echo -e "${YELLOW}步骤 5/5: 启动开发服务器${NC}"
echo ""
echo "======================================"
echo "开发服务器即将启动"
echo "======================================"
echo ""
echo "访问地址: http://localhost:5173"
echo ""
echo "验证清单:"
echo "  1. 主题切换 (点击顶部 ☀️/🌙 图标)"
echo "  2. 侧边栏折叠 (点击底部 ← / → 按钮)"
echo "  3. 移动端响应式 (窗口 <768px)"
echo "  4. 用户下拉菜单"
echo ""
echo "按 Ctrl+C 停止服务器"
echo ""
echo "======================================"
echo ""

npm run dev
