"""
Web界面配置管理模型
"""
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, JSON
from sqlalchemy.sql import func
from src.database import Base

class WebConfig(Base):
    """Web界面配置表"""
    __tablename__ = "web_configs"
    
    id = Column(Integer, primary_key=True, index=True)
    category = Column(String(50), nullable=False, index=True)  # 配置分类
    key = Column(String(100), nullable=False, index=True)      # 配置键
    value = Column(Text, nullable=True)                        # 配置值
    value_type = Column(String(20), default="string")         # 值类型: string, int, bool, json
    description = Column(Text, nullable=True)                 # 配置描述
    is_sensitive = Column(Boolean, default=False)             # 是否敏感信息
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    def to_dict(self):
        """转换为字典"""
        value = self.value
        
        # 根据类型转换值
        if self.value_type == "int":
            value = int(self.value) if self.value else 0
        elif self.value_type == "bool":
            value = self.value.lower() in ("true", "1", "yes") if self.value else False
        elif self.value_type == "json":
            import json
            try:
                value = json.loads(self.value) if self.value else {}
            except:
                value = {}
        
        return {
            "id": self.id,
            "category": self.category,
            "key": self.key,
            "value": value,
            "value_type": self.value_type,
            "description": self.description,
            "is_sensitive": self.is_sensitive,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }

class SystemSettings(Base):
    """系统设置表"""
    __tablename__ = "system_settings"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # 基础配置
    project_name = Column(String(200), default="DanDanPlay API 数据交互中心")
    project_description = Column(Text, default="弹幕API代理系统的数据管理和监控中心")
    
    # 数据库配置
    database_type = Column(String(20), default="sqlite")  # sqlite, mysql, postgresql
    sqlite_path = Column(String(500), default="/app/config/database.db")
    mysql_host = Column(String(100), default="localhost")
    mysql_port = Column(Integer, default=3306)
    mysql_user = Column(String(100), default="root")
    mysql_password = Column(String(200), default="")
    mysql_database = Column(String(100), default="danmu_data_center")
    postgres_host = Column(String(100), default="localhost")
    postgres_port = Column(Integer, default=5432)
    postgres_user = Column(String(100), default="postgres")
    postgres_password = Column(String(200), default="")
    postgres_database = Column(String(100), default="danmu_data_center")
    
    # Telegram机器人配置
    tg_bot_token = Column(String(200), nullable=True)
    tg_admin_user_ids = Column(Text, nullable=True)  # 逗号分隔的用户ID列表
    
    # Worker配置
    worker_endpoints = Column(Text, nullable=True)  # 逗号分隔的Worker端点列表
    worker_api_key = Column(String(200), nullable=True)  # Worker API验证密钥
    
    # 同步配置
    sync_interval_hours = Column(Integer, default=1)
    sync_retry_attempts = Column(Integer, default=3)
    sync_timeout_seconds = Column(Integer, default=30)
    
    # 日志配置
    log_level = Column(String(20), default="INFO")
    
    # 安全配置
    secret_key = Column(String(200), default="your-secret-key-change-in-production")
    access_token_expire_minutes = Column(Integer, default=30)
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    def to_dict(self):
        """转换为字典"""
        return {
            "id": self.id,
            "project_name": self.project_name,
            "project_description": self.project_description,
            "database_type": self.database_type,
            "sqlite_path": self.sqlite_path,
            "mysql_host": self.mysql_host,
            "mysql_port": self.mysql_port,
            "mysql_user": self.mysql_user,
            "mysql_password": "***" if self.mysql_password else "",  # 隐藏密码
            "mysql_database": self.mysql_database,
            "postgres_host": self.postgres_host,
            "postgres_port": self.postgres_port,
            "postgres_user": self.postgres_user,
            "postgres_password": "***" if self.postgres_password else "",  # 隐藏密码
            "postgres_database": self.postgres_database,
            "tg_bot_token": "***" if self.tg_bot_token else "",  # 隐藏Token
            "tg_admin_user_ids": self.tg_admin_user_ids,
            "worker_endpoints": self.worker_endpoints,
            "worker_api_key": "***" if self.worker_api_key else "",  # 隐藏API密钥
            "sync_interval_hours": self.sync_interval_hours,
            "sync_retry_attempts": self.sync_retry_attempts,
            "sync_timeout_seconds": self.sync_timeout_seconds,
            "log_level": self.log_level,
            "secret_key": "***" if self.secret_key else "",  # 隐藏密钥
            "access_token_expire_minutes": self.access_token_expire_minutes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }
    
    def to_dict_with_secrets(self):
        """转换为字典（包含敏感信息）"""
        return {
            "id": self.id,
            "project_name": self.project_name,
            "project_description": self.project_description,
            "database_type": self.database_type,
            "sqlite_path": self.sqlite_path,
            "mysql_host": self.mysql_host,
            "mysql_port": self.mysql_port,
            "mysql_user": self.mysql_user,
            "mysql_password": self.mysql_password,
            "mysql_database": self.mysql_database,
            "postgres_host": self.postgres_host,
            "postgres_port": self.postgres_port,
            "postgres_user": self.postgres_user,
            "postgres_password": self.postgres_password,
            "postgres_database": self.postgres_database,
            "tg_bot_token": self.tg_bot_token,
            "tg_admin_user_ids": self.tg_admin_user_ids,
            "worker_endpoints": self.worker_endpoints,
            "worker_api_key": self.worker_api_key,
            "sync_interval_hours": self.sync_interval_hours,
            "sync_retry_attempts": self.sync_retry_attempts,
            "sync_timeout_seconds": self.sync_timeout_seconds,
            "log_level": self.log_level,
            "secret_key": self.secret_key,
            "access_token_expire_minutes": self.access_token_expire_minutes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }
