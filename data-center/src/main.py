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
from src.telegram.bot import TelegramBot
from src.tasks.scheduler import TaskScheduler
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
    if settings.TG_BOT_TOKEN and settings.TG_ADMIN_USER_ID:
        logger.info("🤖 启动Telegram机器人（轮询模式）...")
        telegram_bot = TelegramBot(
            token=settings.TG_BOT_TOKEN,
            admin_user_id=settings.TG_ADMIN_USER_ID
        )
        # 在后台任务中启动机器人
        bot_task = asyncio.create_task(telegram_bot.start())
        logger.info("✅ Telegram机器人启动成功")
    else:
        logger.warning("⚠️ TG机器人配置不完整，跳过启动")
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
    
    if bot_task:
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
    try:
        app.mount("/", StaticFiles(directory="web/dist", html=True), name="static")
        logger.info("✅ 静态文件服务已挂载")
    except Exception as e:
        logger.warning(f"⚠️ 静态文件服务挂载失败: {e}")

    return app

# 创建应用实例
app = create_application()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "src.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
