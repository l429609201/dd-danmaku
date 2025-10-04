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
from src.api.v1.api import api_router
from src.tasks.scheduler import TaskScheduler
from src.telegram.bot import TelegramBot
from src.middleware.auth_middleware import AuthMiddleware

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 全局变量存储服务实例
telegram_bot = None
task_scheduler = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    global telegram_bot, task_scheduler
    
    logger.info("🚀 启动数据交互中心...")
    
    # 初始化数据库
    logger.info("📊 初始化数据库...")
    await init_db()
    
    # 启动TG机器人（轮询模式）
    from src.services.web_config_service import WebConfigService
    web_config_service = WebConfigService()
    settings_data = await web_config_service.get_system_settings()

    if settings_data and settings_data.tg_bot_token and settings_data.tg_admin_user_ids:
        logger.info("🤖 启动Telegram机器人（轮询模式）...")
        telegram_bot = TelegramBot(
            token=settings_data.tg_bot_token,
            admin_user_ids=settings_data.tg_admin_user_ids.split(',') if settings_data.tg_admin_user_ids else []
        )

        # 在后台任务中启动机器人
        bot_task = asyncio.create_task(telegram_bot.start())
        logger.info("✅ Telegram机器人启动成功")
    else:
        logger.info("ℹ️ TG机器人未配置，请通过Web界面配置后重启服务")
        bot_task = None
    
    # 启动定时任务调度器
    logger.info("⏰ 启动任务调度器...")
    task_scheduler = TaskScheduler()
    await task_scheduler.start()
    logger.info("✅ 任务调度器启动成功")
    
    logger.info("🎉 数据交互中心启动完成！")
    
    yield
    
    # 关闭时清理资源
    logger.info("🛑 正在关闭数据交互中心...")

    if 'bot_task' in locals() and bot_task:
        logger.info("🤖 停止Telegram机器人...")
        bot_task.cancel()
        if telegram_bot:
            await telegram_bot.stop()

    if task_scheduler:
        logger.info("⏰ 停止任务调度器...")
        await task_scheduler.stop()

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

    # 认证中间件
    app.add_middleware(AuthMiddleware)

    # CORS中间件
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_HOSTS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # API路由
    app.include_router(api_router, prefix=settings.API_V1_STR)

    # 健康检查端点
    @app.get("/health")
    async def health_check():
        return {
            "status": "healthy",
            "telegram_bot": telegram_bot is not None,
            "task_scheduler": task_scheduler is not None
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

    # 调试信息
    logger.info(f"🔍 运行环境: {'Docker' if is_docker else '本地开发'}")
    logger.info(f"🔍 当前工作目录: {Path.cwd()}")
    logger.info(f"🔍 静态文件目录: {static_dir}")
    logger.info(f"🔍 静态文件目录存在: {static_dir.exists()}")
    if static_dir.exists():
        logger.info(f"🔍 静态文件目录内容: {list(static_dir.iterdir())}")
        index_file = static_dir / "index.html"
        logger.info(f"🔍 index.html存在: {index_file.exists()}")
        if index_file.exists():
            # 读取index.html的前200个字符来检查内容
            try:
                with open(index_file, 'r', encoding='utf-8') as f:
                    content = f.read(200)
                    logger.info(f"🔍 index.html内容预览: {content}")
            except Exception as e:
                logger.warning(f"⚠️ 读取index.html失败: {e}")

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
        # 记录SPA路由被调用
        logger.info(f"🔍 SPA路由被调用: {full_path}")

        # API路径让其他路由处理
        if (full_path.startswith("api/") or
            full_path.startswith("health") or
            full_path.startswith("docs") or
            full_path.startswith("assets/") or
            full_path.startswith("images/")):
            logger.info(f"🔍 路径被排除，交给其他路由处理: {full_path}")
            raise HTTPException(status_code=404, detail="Not found")

        # 检查构建产物是否存在
        if final_static_dir.exists() and final_static_dir.is_dir():
            # 返回构建后的index.html
            index_file = final_static_dir / "index.html"
            logger.info(f"🔍 尝试返回index.html: {index_file}")
            if index_file.exists():
                return FileResponse(str(index_file))
            else:
                logger.warning(f"⚠️ index.html不存在: {index_file}")
                return HTMLResponse("Frontend index.html not found", status_code=404)
        else:
            # 返回fallback页面
            logger.info(f"🔍 返回fallback页面")
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
                        <a href="/api/v1/auth/init-status">⚙️ 初始化状态</a>
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
