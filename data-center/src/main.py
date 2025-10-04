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

    # 静态文件服务（Vue.js构建产物）
    import os
    static_dir = "web/dist"
    if os.path.exists(static_dir) and os.path.isdir(static_dir):
        try:
            app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
            logger.info("✅ 静态文件服务已挂载")
        except Exception as e:
            logger.warning(f"⚠️ 静态文件服务挂载失败: {e}")
    else:
        logger.warning(f"⚠️ 静态文件目录不存在: {static_dir}")
        logger.info("💡 请确保前端已构建，或访问 /docs 查看API文档")

        # 添加简单的fallback页面
        from fastapi.responses import HTMLResponse

        @app.get("/", response_class=HTMLResponse)
        async def fallback_index():
            return """
            <!DOCTYPE html>
            <html>
            <head>
                <title>DanDanPlay API 数据交互中心</title>
                <meta charset="utf-8">
                <style>
                    body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
                    .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                    h1 { color: #333; text-align: center; }
                    .status { background: #e3f2fd; padding: 20px; border-radius: 4px; margin: 20px 0; }
                    .links { text-align: center; margin-top: 30px; }
                    .links a { display: inline-block; margin: 0 10px; padding: 10px 20px; background: #1976d2; color: white; text-decoration: none; border-radius: 4px; }
                    .links a:hover { background: #1565c0; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🎯 DanDanPlay API 数据交互中心</h1>
                    <div class="status">
                        <h3>📊 系统状态</h3>
                        <p>✅ 后端服务正常运行</p>
                        <p>⚠️ 前端界面构建中...</p>
                        <p>💡 您可以直接使用API接口或查看文档</p>
                    </div>
                    <div class="links">
                        <a href="/docs">📖 API文档</a>
                        <a href="/health">🔍 健康检查</a>
                        <a href="/api/v1/auth/init-status">⚙️ 初始化状态</a>
                    </div>
                </div>
            </body>
            </html>
            """

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
