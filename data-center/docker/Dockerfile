# 多阶段构建Dockerfile - 优化版本

# 前端构建阶段
FROM node:18-alpine AS frontend-builder

WORKDIR /app/web

# 复制前端依赖文件
COPY web/package*.json ./

# 安装依赖（使用npm ci提高速度和可靠性）
RUN npm ci --only=production --no-audit --no-fund

# 复制前端源码
COPY web/ .

# 构建前端
RUN npm run build && \
    # 清理不需要的文件
    rm -rf node_modules src public *.json *.js *.ts

# Python运行时阶段
FROM python:3.11-alpine AS runtime

WORKDIR /app

# 安装运行时依赖（最小化）
RUN apk add --no-cache \
    wget \
    && rm -rf /var/cache/apk/*

# 创建非root用户
RUN addgroup -g 1000 appuser && \
    adduser -u 1000 -G appuser -s /bin/sh -D appuser

# 复制Python依赖文件
COPY requirements/ requirements/

# 安装Python依赖（使用Alpine的优化）
RUN pip install --no-cache-dir --no-compile --disable-pip-version-check -r requirements/prod.txt && \
    # 清理pip缓存和临时文件
    pip cache purge && \
    rm -rf /root/.cache/pip && \
    rm -rf /tmp/* && \
    rm -rf requirements/ && \
    # 移除不需要的包管理工具
    find /usr/local -name '*.pyc' -delete && \
    find /usr/local -name '*.pyo' -delete

# 复制后端源码
COPY --chown=appuser:appuser src/ ./src/

# 复制前端构建产物
COPY --from=frontend-builder --chown=appuser:appuser /app/web/dist ./web/dist

# 创建必要的目录
RUN mkdir -p /app/config /app/config/logs /app/config/backups && \
    chown -R appuser:appuser /app/config

# 切换到非root用户
USER appuser

# 设置环境变量
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# 暴露端口
EXPOSE 7759

# 健康检查（使用wget代替curl，更轻量）
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:7759/health || exit 1

# 启动命令
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "7759", "--workers", "1"]
