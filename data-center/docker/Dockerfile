# 多阶段构建Dockerfile

# 前端构建阶段
FROM node:18-alpine AS frontend-builder

WORKDIR /app/web

# 复制前端依赖文件
COPY web/package*.json ./

# 安装前端依赖
RUN npm install --omit=dev

# 复制前端源码
COPY web/ .

# 构建前端
RUN npm run build

# Python后端阶段
FROM python:3.11-slim AS backend

WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 复制Python依赖文件
COPY requirements/ requirements/

# 安装Python依赖
RUN pip install --no-cache-dir -r requirements/prod.txt

# 复制后端源码
COPY src/ ./src/

# 复制前端构建产物
COPY --from=frontend-builder /app/web/dist ./web/dist

# 创建必要的目录
RUN mkdir -p /app/config /app/config/logs /app/config/backups

# 设置环境变量
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

# 暴露端口
EXPOSE 7759

# 健康检查
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:7759/health || exit 1

# 启动命令
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "7759", "--workers", "1"]
