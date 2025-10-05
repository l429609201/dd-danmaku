"""
数据库连接和配置
"""
import logging
from sqlalchemy import create_engine, MetaData, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool

from src.config import settings

logger = logging.getLogger(__name__)

# 数据库引擎配置
if settings.database_url.startswith("sqlite"):
    # SQLite配置
    engine = create_engine(
        settings.database_url,
        echo=settings.DATABASE_ECHO,
        connect_args={
            "check_same_thread": False,
            "timeout": 20
        },
        poolclass=StaticPool,
    )
else:
    # PostgreSQL或其他数据库配置
    engine = create_engine(
        settings.database_url,
        echo=settings.DATABASE_ECHO,
        pool_pre_ping=True,
        pool_recycle=300,
    )

# 会话工厂
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 基础模型类
Base = declarative_base()

# 元数据
metadata = MetaData()

def get_db() -> Session:
    """获取数据库会话"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

async def init_db():
    """初始化数据库"""
    try:
        logger.info("🔧 正在初始化数据库...")
        
        # 导入所有模型以确保表被创建
        from src.models import config, stats, logs, web_config, auth
        # 确保模型被加载
        _ = web_config, auth
        
        # 创建所有表
        Base.metadata.create_all(bind=engine)
        
        logger.info("✅ 数据库初始化完成")
        
        # 初始化默认数据
        await init_default_data()

        # 初始化Web配置
        await init_web_config()

        # 初始化管理员用户
        await init_admin_user()
        
    except Exception as e:
        logger.error(f"❌ 数据库初始化失败: {e}")
        raise

async def init_default_data():
    """初始化默认数据"""
    try:
        from src.models.config import UAConfig
        
        db = SessionLocal()
        
        # 检查是否已有默认UA配置
        existing_config = db.query(UAConfig).filter(UAConfig.name == "default").first()
        
        if not existing_config:
            logger.info("🔧 创建默认UA配置...")
            
            default_ua = UAConfig(
                name="default",
                user_agent="default",
                hourly_limit=50,
                enabled=True,
                path_specific_limits={}
            )
            
            db.add(default_ua)
            db.commit()
            
            logger.info("✅ 默认UA配置创建完成")
        
        db.close()
        
    except Exception as e:
        logger.error(f"❌ 初始化默认数据失败: {e}")

async def init_web_config():
    """初始化Web配置"""
    try:
        from src.services.web_config_service import WebConfigService

        web_config_service = WebConfigService()
        await web_config_service.init_default_configs()

        logger.info("✅ Web配置初始化完成")

    except Exception as e:
        logger.error(f"❌ 初始化Web配置失败: {e}")

async def init_admin_user():
    """初始化管理员用户"""
    try:
        from src.services.auth_service import AuthService
        from src.models.auth import User

        # 检查是否已存在管理员
        db = SessionLocal()
        admin_exists = db.query(User).filter(User.is_admin == True).first()
        db.close()

        if not admin_exists:
            auth_service = AuthService()
            admin_user, password = await auth_service.create_admin_user()

            logger.info("✅ 管理员用户初始化完成")
            logger.info(f"🔑 管理员账户: {admin_user.username}")
            logger.info(f"🔑 初始密码: {password}")
            logger.info("⚠️ 请妥善保存密码，首次登录后建议立即修改")
        else:
            logger.info("✅ 管理员用户已存在，跳过初始化")

    except Exception as e:
        logger.error(f"❌ 初始化管理员用户失败: {e}")

def get_db_sync() -> Session:
    """获取同步数据库会话（用于非异步上下文）"""
    return SessionLocal()

def close_db_connections():
    """关闭数据库连接"""
    try:
        engine.dispose()
        logger.info("✅ 数据库连接已关闭")
    except Exception as e:
        logger.error(f"❌ 关闭数据库连接失败: {e}")

# 数据库健康检查
def check_db_health() -> bool:
    """检查数据库连接健康状态"""
    try:
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()
        return True
    except Exception as e:
        logger.error(f"❌ 数据库健康检查失败: {e}")
        return False
