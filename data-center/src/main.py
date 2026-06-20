"""
数据交互中心主应用入口
FastAPI + TG机器人轮询模式
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from src.config import settings
from src.database import init_db
from src.utils import naive_now
from src.api.v2.api import api_v2_router
from src.services_v2.redis_cache import redis_cache
from src.services_v2.control_client import control_client
from src.services_v2.cleanup_service import cleanup_service

# 配置日志系统
from src.utils.logger_setup import setup_logging

# 初始化日志系统
setup_logging()
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理（新架构：Redis 热缓存 + Worker 长连接客户端）"""
    logger.info("🚀 启动数据交互中心...")

    # 初始化数据库（仅创建 models_v2 新表）
    logger.info("📊 初始化数据库...")
    await init_db()

    # 连接 Redis 热缓存（失败自动降级，不阻塞启动）
    logger.info("🧱 连接 Redis 热缓存...")
    await redis_cache.connect()

    # 启动本地端 WebSocket 控制客户端（主动连 Worker ControlHub）
    logger.info("🔌 启动 Worker 长连接控制客户端...")
    await control_client.start()

    # 启动本地端 SQL 数据保留清理任务
    logger.info("🧹 启动数据保留清理任务...")
    await cleanup_service.start()

    logger.info("🎉 数据交互中心启动完成！")

    yield

    # 关闭时清理资源
    logger.info("🛑 正在关闭数据交互中心...")
    await cleanup_service.stop()
    await control_client.stop()
    await redis_cache.close()
    logger.info("✅ 数据交互中心已安全关闭")

def create_application() -> FastAPI:
    """创建FastAPI应用"""
    app = FastAPI(
        title=settings.PROJECT_NAME,
        description=settings.PROJECT_DESCRIPTION,
        version=settings.VERSION,
        openapi_url=f"{settings.API_V1_STR}/openapi.json",
        lifespan=lifespan
    )

    # CORS中间件（v2 认证改为各接口 Depends(get_current_user)，不再用全局中间件）
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_HOSTS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # API v2 路由（新架构唯一业务入口）
    app.include_router(api_v2_router, prefix="/api/v2")

    # 健康检查端点
    @app.get("/health")
    async def health_check():
        """简单的健康检查端点"""
        return {
            "status": "healthy",
            "timestamp": naive_now().isoformat()
        }

    # 静态文件服务配置
    import os
    from pathlib import Path
    from fastapi.responses import HTMLResponse

    # 检测运行环境
    def _is_docker_environment():
        if Path("/.dockerenv").exists():
            return True
        if os.getenv("DOCKER_CONTAINER") == "true" or os.getenv("IN_DOCKER") == "true":
            return True
        if Path.cwd() == Path("/app"):
            return True
        return False

    # 根据环境确定静态文件目录
    is_docker = _is_docker_environment()
    if is_docker:
        static_dir = Path("/app/web/dist")
        dev_static_dir = Path("/app/web")
    else:
        static_dir = Path("web/dist")
        dev_static_dir = Path("web")

    # 基本信息
    logger.info(f"🔍 运行环境: {'Docker' if is_docker else '本地开发'}")
    logger.info(f"🔍 静态文件目录: {static_dir}")
    if static_dir.exists():
        logger.info(f"✅ 前端构建产物已就绪")
    else:
        logger.warning(f"⚠️ 前端构建产物不存在，将显示fallback页面")

    # 尝试挂载构建后的静态文件
    if static_dir.exists() and static_dir.is_dir():
        try:
            # 参考misaka项目的挂载方式
            # 挂载静态资源目录
            assets_dir = static_dir / "assets"
            if assets_dir.exists():
                app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")
                logger.info("✅ 静态资源目录已挂载: /assets")

            # 挂载图片目录（如果存在）
            images_dir = static_dir / "images"
            if images_dir.exists():
                app.mount("/images", StaticFiles(directory=str(images_dir)), name="images")
                logger.info("✅ 图片目录已挂载: /images")

            # 添加favicon处理
            from fastapi.responses import FileResponse

            @app.get("/favicon.svg", include_in_schema=False)
            async def favicon_svg():
                favicon_path = static_dir / "favicon.svg"
                if favicon_path.exists():
                    return FileResponse(str(favicon_path), media_type="image/svg+xml")
                else:
                    # 返回默认的SVG favicon
                    public_favicon = Path(__file__).parent.parent / "web" / "public" / "favicon.svg"
                    if public_favicon.exists():
                        return FileResponse(str(public_favicon), media_type="image/svg+xml")
                    else:
                        from fastapi import HTTPException
                        raise HTTPException(status_code=404, detail="Favicon not found")

            @app.get("/favicon.ico", include_in_schema=False)
            async def favicon_ico():
                favicon_path = static_dir / "favicon.ico"
                if favicon_path.exists():
                    return FileResponse(str(favicon_path), media_type="image/x-icon")
                else:
                    # 如果没有favicon.ico，返回404
                    from fastapi import HTTPException
                    raise HTTPException(status_code=404, detail="Favicon not found")

            # 不挂载整个dist目录，而是在SPA路由中直接返回文件
            logger.info("✅ 静态文件挂载完成，等待SPA路由配置")

        except Exception as e:
            logger.warning(f"⚠️ 静态文件服务挂载失败: {e}")
    else:
        # 开发环境或构建产物不存在：提供fallback页面
        logger.warning(f"⚠️ 构建产物不存在: {static_dir}")
        logger.info("💡 请先构建前端或访问 /docs 查看API文档")

        # 注意：不在这里定义fallback路由，而是在最后的SPA路由中处理

    # 最后添加SPA路由支持（必须在所有API路由之后）
    # 重新检查静态文件目录
    if _is_docker_environment():
        final_static_dir = Path("/app/web/dist")
    else:
        final_static_dir = Path("web/dist")

    from fastapi.responses import FileResponse
    from fastapi import Request, HTTPException

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(request: Request, full_path: str):
        # API路径让其他路由处理
        if (full_path.startswith("api/") or
            full_path.startswith("worker-api/") or
            full_path.startswith("health") or
            full_path.startswith("docs") or
            full_path.startswith("openapi.json") or
            full_path.startswith("redoc") or
            full_path.startswith("assets/") or
            full_path.startswith("images/")):
            raise HTTPException(status_code=404, detail="Not found")

        # 检查构建产物是否存在
        if final_static_dir.exists() and final_static_dir.is_dir():
            # 返回构建后的index.html
            index_file = final_static_dir / "index.html"
            if index_file.exists():
                return FileResponse(str(index_file))
            else:
                return HTMLResponse("Frontend index.html not found", status_code=404)
        else:
            # 返回fallback页面
            return HTMLResponse("""
            <!DOCTYPE html>
            <html lang="zh-CN">
            <head>
                <title>DanDanPlay API 数据交互中心</title>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
                    .container { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 20px 40px rgba(0,0,0,0.1); max-width: 500px; width: 90%; text-align: center; }
                    h1 { color: #333; margin-bottom: 20px; font-size: 24px; }
                    .status { background: #f8f9ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
                    .status h3 { color: #667eea; margin-bottom: 15px; }
                    .status p { color: #666; margin: 8px 0; }
                    .links { margin-top: 30px; }
                    .links a { display: inline-block; margin: 8px; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 6px; transition: all 0.3s; }
                    .links a:hover { background: #5a67d8; transform: translateY(-2px); }
                    .build-info { background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px; padding: 15px; margin: 20px 0; color: #856404; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🎯 DanDanPlay API 数据交互中心</h1>
                    <div class="status">
                        <h3>📊 系统状态</h3>
                        <p>✅ 后端服务正常运行</p>
                        <p>⚠️ 前端界面需要构建</p>
                    </div>
                    <div class="build-info">
                        <strong>💡 构建前端界面：</strong><br>
                        <code>cd data-center/web && npm install && npm run build</code>
                    </div>
                    <div class="links">
                        <a href="/docs">📖 API文档</a>
                        <a href="/health">🔍 健康检查</a>
                        <a href="/api/auth/init-status">⚙️ 初始化状态</a>
                    </div>
                </div>
            </body>
            </html>
            """)

    logger.info("✅ SPA路由支持已启用")

    return app

# 创建应用实例
app = create_application()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "src.main:app",
        host="0.0.0.0",
        port=7759,
        reload=True,
        log_level="info"
    )
