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
    # MySQL/PostgreSQL 连接池优化配置
    # 参考 misaka_danmu_server 的配置
    engine = create_engine(
        settings.database_url,
        echo=settings.DATABASE_ECHO,
        pool_pre_ping=True,      # 连接前检查连接是否有效
        pool_recycle=3600,       # 1小时回收连接（misaka_danmu_server 使用 3600）
        pool_size=40,            # 连接池大小（misaka_danmu_server 使用 20）
        max_overflow=40,         # 最大溢出连接数（misaka_danmu_server 使用 40）
        pool_timeout=30,         # 获取连接超时时间（秒）（misaka_danmu_server 使用 30）
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
    """初始化数据库（新架构：仅创建 models_v2 新表，废弃旧表/旧迁移）"""
    try:
        logger.info("🔧 正在初始化数据库（models_v2）...")

        # 仅导入 models_v2，旧 models 包彻底废弃，不再创建旧表
        import src.models_v2  # noqa: F401

        # 创建所有 v2 表
        Base.metadata.create_all(bind=engine)
        await ensure_compatible_schema()
        logger.info("✅ 数据库表结构初始化完成")

        # 初始化系统默认设置
        await init_app_settings()

        # 初始化默认管理员（LocalUser）
        await init_admin_user()

    except Exception as e:
        logger.error(f"❌ 数据库初始化失败: {e}")
        raise


async def ensure_compatible_schema():
    """表完整性检查：基于 ORM 模型自动补齐缺失字段（只增不删）。

    替代过去逐个手写 ALTER 的方式——以后给模型加字段，重启即自动补列，
    无需再在此处硬编码。删表/删列/改类型等敏感操作一律不执行。
    """
    try:
        from src.database_schema_guard import SchemaGuard
        guard = SchemaGuard(engine, Base.metadata)
        guard.run()
    except Exception as e:
        logger.error(f"❌ 表完整性检查失败: {e}")
        raise


async def init_app_settings():
    """初始化系统默认设置（app_settings）"""
    try:
        from src.models_v2 import AppSetting

        # key -> (value, value_type, description, is_secret)
        defaults = {
            "control_worker_ws_url": (settings.CONTROL_WORKER_WS_URL or "", "string", "Worker ControlHub WebSocket 地址", False),
            "control_token": (settings.CONTROL_TOKEN or "", "secret", "Worker 控制 token", True),
            "node_id": (settings.CONTROL_NODE_ID, "string", "本地节点 ID", False),
            "cache_refresh_interval_seconds": (str(settings.CACHE_REFRESH_INTERVAL_SECONDS), "int", "缓存刷新间隔（秒）", False),
            "cache_stale_max_age_seconds": (str(settings.CACHE_STALE_MAX_AGE_SECONDS), "int", "缓存最大兜底时长（秒）", False),
            "cache_get_timeout_ms": ("800", "int", "Worker cache.get 超时（毫秒）", False),
            # 本地端 SQL 数据保留策略（第一版 asyncio 后台任务读取这些配置）
            "cleanup_enabled": ("true", "bool", "是否启用本地端 SQL 数据保留清理", False),
            "cleanup_interval_seconds": ("3600", "int", "数据保留清理任务执行间隔（秒）", False),
            "cleanup_access_log_retention_days": ("30", "int", "缓存访问日志保留天数", False),
            "cleanup_control_message_retention_days": ("30", "int", "长连接消息审计保留天数", False),
            "cleanup_runtime_event_retention_days": ("30", "int", "运行事件保留天数", False),
            "cleanup_expired_cache_enabled": ("false", "bool", "是否删除过期响应缓存空壳", False),
            "cleanup_expired_cache_retention_days": ("90", "int", "过期响应缓存空壳额外保留天数", False),
        }

        db = SessionLocal()
        try:
            for key, (value, vtype, desc, is_secret) in defaults.items():
                exists = db.query(AppSetting).filter(AppSetting.key == key).first()
                if not exists:
                    db.add(AppSetting(
                        key=key, value=value, value_type=vtype,
                        description=desc, is_secret=is_secret,
                    ))
            db.commit()
            logger.info("✅ 系统默认设置初始化完成")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"❌ 初始化系统默认设置失败: {e}")


async def init_admin_user():
    """初始化默认管理员用户（LocalUser）"""
    try:
        import os
        import secrets
        import string
        from src.models_v2 import LocalUser

        db = SessionLocal()
        try:
            admin_exists = db.query(LocalUser).filter(
                LocalUser.role == "admin"
            ).first()
            if admin_exists:
                logger.info("✅ 管理员用户已存在，跳过初始化")
                return

            username = os.getenv("ADMIN_USERNAME", "admin")
            password = os.getenv("ADMIN_PASSWORD")
            if not password:
                alphabet = string.ascii_letters + string.digits
                password = "".join(secrets.choice(alphabet) for _ in range(12))

            admin = LocalUser(
                username=username,
                display_name="管理员",
                role="admin",
                is_active=True,
                is_superuser=True,
            )
            admin.set_password(password)
            db.add(admin)
            db.commit()

            logger.info("✅ 默认管理员用户创建完成")
            logger.info(f"🔑 管理员账户: {username}")
            logger.info(f"🔑 初始密码: {password}")
            logger.info("⚠️ 请妥善保存密码，首次登录后建议立即修改")
        finally:
            db.close()
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
