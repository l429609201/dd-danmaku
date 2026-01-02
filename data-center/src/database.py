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

        # 执行数据库迁移（添加缺失的列）
        await migrate_database()

        # 初始化默认数据
        await init_default_data()

        # 初始化Web配置
        await init_web_config()

        # 初始化管理员用户
        await init_admin_user()

    except Exception as e:
        logger.error(f"❌ 数据库初始化失败: {e}")
        raise

async def migrate_database():
    """数据库迁移 - 添加缺失的列"""
    try:
        db = SessionLocal()

        # 检查并添加缺失的列
        migrations = [
            # (表名, 列名, 列类型)
            ("worker_configs", "ua_configs", "JSON"),
            ("worker_configs", "ip_blacklist", "JSON"),
            ("worker_configs", "secret_usage", "JSON"),
            ("worker_configs", "last_update", "BIGINT"),
            # RequestStats 表的新列
            ("request_stats", "active_ips_count", "INTEGER DEFAULT 0"),
        ]

        # 需要修改列类型的迁移（MySQL 专用）
        column_type_changes = [
            # (表名, 列名, 新类型) - Telegram user_id 可能超过 INT 范围
            ("telegram_logs", "user_id", "BIGINT"),
        ]

        # 需要修改列约束的迁移（MySQL 专用）
        column_nullable_changes = [
            # (表名, 列名, 列类型, 是否允许NULL)
            ("worker_configs", "endpoint", "VARCHAR(500)", True),
        ]

        for table_name, column_name, column_type in migrations:
            try:
                # 检查列是否存在
                if settings.database_url.startswith("sqlite"):
                    # SQLite 检查列是否存在
                    result = db.execute(text(f"PRAGMA table_info({table_name})"))
                    columns = [row[1] for row in result.fetchall()]

                    if column_name not in columns:
                        # 添加列
                        db.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"))
                        db.commit()
                        logger.info(f"✅ 已添加列: {table_name}.{column_name}")
                    else:
                        logger.debug(f"ℹ️ 列已存在: {table_name}.{column_name}")
                else:
                    # PostgreSQL 检查列是否存在
                    result = db.execute(text(f"""
                        SELECT column_name FROM information_schema.columns
                        WHERE table_name = '{table_name}' AND column_name = '{column_name}'
                    """))
                    if not result.fetchone():
                        db.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"))
                        db.commit()
                        logger.info(f"✅ 已添加列: {table_name}.{column_name}")
                    else:
                        logger.debug(f"ℹ️ 列已存在: {table_name}.{column_name}")

            except Exception as e:
                # 如果表不存在或其他错误，跳过
                logger.debug(f"ℹ️ 迁移跳过 {table_name}.{column_name}: {e}")
                db.rollback()
                continue

        # 处理列类型修改（MySQL/MariaDB 专用）
        if not settings.database_url.startswith("sqlite"):
            for table_name, column_name, new_type in column_type_changes:
                try:
                    # 检查当前列类型
                    result = db.execute(text(f"""
                        SELECT data_type FROM information_schema.columns
                        WHERE table_name = '{table_name}' AND column_name = '{column_name}'
                    """))
                    row = result.fetchone()
                    if row:
                        current_type = row[0].upper()
                        if current_type != new_type.upper():
                            # 修改列类型
                            db.execute(text(f"ALTER TABLE {table_name} MODIFY COLUMN {column_name} {new_type}"))
                            db.commit()
                            logger.info(f"✅ 已修改列类型: {table_name}.{column_name} -> {new_type}")
                        else:
                            logger.debug(f"ℹ️ 列类型已正确: {table_name}.{column_name} = {new_type}")
                except Exception as e:
                    logger.debug(f"ℹ️ 列类型修改跳过 {table_name}.{column_name}: {e}")
                    db.rollback()
                    continue

            # 处理列约束修改（允许 NULL）
            for table_name, column_name, column_type, nullable in column_nullable_changes:
                try:
                    null_str = "NULL" if nullable else "NOT NULL"
                    db.execute(text(f"ALTER TABLE {table_name} MODIFY COLUMN {column_name} {column_type} {null_str}"))
                    db.commit()
                    logger.info(f"✅ 已修改列约束: {table_name}.{column_name} -> {null_str}")
                except Exception as e:
                    logger.debug(f"ℹ️ 列约束修改跳过 {table_name}.{column_name}: {e}")
                    db.rollback()
                    continue

        db.close()
        logger.info("✅ 数据库迁移检查完成")

    except Exception as e:
        logger.error(f"❌ 数据库迁移失败: {e}")

async def init_default_data():
    """初始化默认数据"""
    try:
        # 不再创建默认UA配置，让用户自己配置
        logger.info("ℹ️ 跳过默认数据初始化，用户需要自行配置UA")
        pass

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
