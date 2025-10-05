"""
应用配置管理
"""
import os
from typing import List, Optional
from pydantic_settings import BaseSettings
from pydantic import validator

class Settings(BaseSettings):
    """应用配置"""
    
    # 基础配置
    PROJECT_NAME: str = "Worker 数据交互中心"
    PROJECT_DESCRIPTION: str = "Worker API代理系统的数据管理和监控中心"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api"
    
    # 服务器配置
    HOST: str = "0.0.0.0"
    PORT: int = 7759
    DEBUG: bool = False
    
    # 跨域配置
    ALLOWED_HOSTS: List[str] = ["*"]
    
    # 数据库配置
    DATABASE_TYPE: str = "sqlite"  # sqlite, mysql, postgresql
    DATABASE_URL: Optional[str] = None  # 如果指定则直接使用

    # SQLite配置
    SQLITE_PATH: str = "/app/config/database.db"

    # MySQL配置
    MYSQL_HOST: str = "localhost"
    MYSQL_PORT: int = 3306
    MYSQL_USER: str = "root"
    MYSQL_PASSWORD: str = ""
    MYSQL_DATABASE: str = "danmu_data_center"

    # PostgreSQL配置
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = ""
    POSTGRES_DATABASE: str = "danmu_data_center"

    # 配置文件路径
    CONFIG_PATH: str = "/app/config"
    DATABASE_ECHO: bool = False
    
    # Telegram机器人配置
    TG_BOT_TOKEN: Optional[str] = None
    TG_ADMIN_USER_ID: Optional[str] = None
    
    # Worker端点配置
    WORKER_ENDPOINTS: Optional[str] = None  # 逗号分隔的Worker地址列表
    WORKER_API_KEYS: Optional[str] = None  # 逗号分隔的Worker API密钥列表

    # 同步配置
    SYNC_INTERVAL_HOURS: int = 1  # 同步间隔（小时）
    SYNC_RETRY_ATTEMPTS: int = 3  # 同步重试次数
    SYNC_TIMEOUT_SECONDS: int = 30  # 同步超时时间
    
    # 日志配置
    LOG_LEVEL: str = "INFO"
    LOG_FILE: Optional[str] = "/app/config/logs/app.log"
    
    # 安全配置
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    
    @validator("TG_ADMIN_USER_ID")
    def parse_admin_user_ids(cls, v):
        """解析管理员用户ID列表"""
        if not v:
            return []
        return [int(uid.strip()) for uid in v.split(",") if uid.strip()]
    
    @validator("WORKER_ENDPOINTS")
    def parse_worker_endpoints(cls, v):
        """解析Worker端点列表"""
        if not v:
            return []
        return [endpoint.strip() for endpoint in v.split(",") if endpoint.strip()]

    @validator("WORKER_API_KEYS")
    def parse_worker_api_keys(cls, v):
        """解析Worker API密钥列表"""
        if not v:
            return []
        return [key.strip() for key in v.split(",") if key.strip()]
    
    @property
    def database_url(self) -> str:
        """根据数据库类型生成连接URL"""
        if self.DATABASE_URL:
            return self.DATABASE_URL

        if self.DATABASE_TYPE.lower() == "sqlite":
            return f"sqlite:///{self.SQLITE_PATH}"
        elif self.DATABASE_TYPE.lower() == "mysql":
            return f"mysql+pymysql://{self.MYSQL_USER}:{self.MYSQL_PASSWORD}@{self.MYSQL_HOST}:{self.MYSQL_PORT}/{self.MYSQL_DATABASE}"
        elif self.DATABASE_TYPE.lower() == "postgresql":
            return f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DATABASE}"
        else:
            # 默认使用SQLite
            return f"sqlite:///{self.SQLITE_PATH}"
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True

# 创建全局配置实例
settings = Settings()

# 确保必要的目录存在
def ensure_directories():
    """确保必要的目录存在"""
    config_path = settings.CONFIG_PATH
    directories = [
        config_path,
        f"{config_path}/logs",
        f"{config_path}/backups"
    ]

    for directory in directories:
        if not os.path.exists(directory):
            os.makedirs(directory, exist_ok=True)

# 初始化时创建目录
ensure_directories()
