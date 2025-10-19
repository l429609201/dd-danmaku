"""
配置相关数据模型
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, JSON, Text
from sqlalchemy.sql import func

from src.database import Base

class UAConfig(Base):
    """UA配置模型"""
    __tablename__ = "ua_configs"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, index=True, nullable=False, comment="配置名称")
    user_agent = Column(String(500), nullable=False, comment="User-Agent字符串")
    hourly_limit = Column(Integer, default=100, comment="每小时请求限制")
    enabled = Column(Boolean, default=True, comment="是否启用")
    path_specific_limits = Column(JSON, default={}, comment="路径特定限制")
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), comment="更新时间")
    
    def __repr__(self):
        return f"<UAConfig(name='{self.name}', user_agent='{self.user_agent}', enabled={self.enabled})>"
    
    def to_dict(self):
        """转换为字典"""
        return {
            "id": self.id,
            "name": self.name,
            "user_agent": self.user_agent,
            "hourly_limit": self.hourly_limit,
            "enabled": self.enabled,
            "path_specific_limits": self.path_specific_limits or {},
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }

class IPBlacklist(Base):
    """IP黑名单模型"""
    __tablename__ = "ip_blacklist"
    
    id = Column(Integer, primary_key=True, index=True)
    ip_address = Column(String(45), unique=True, index=True, nullable=False, comment="IP地址")
    reason = Column(String(500), comment="封禁原因")
    enabled = Column(Boolean, default=True, comment="是否启用")
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), comment="更新时间")
    
    def __repr__(self):
        return f"<IPBlacklist(ip='{self.ip_address}', reason='{self.reason}', enabled={self.enabled})>"
    
    def to_dict(self):
        """转换为字典"""
        return {
            "id": self.id,
            "ip_address": self.ip_address,
            "reason": self.reason,
            "enabled": self.enabled,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }

class WorkerConfig(Base):
    """Worker配置模型"""
    __tablename__ = "worker_configs"

    id = Column(Integer, primary_key=True, index=True)
    worker_id = Column(String(100), unique=True, index=True, nullable=False, comment="Worker标识")
    endpoint = Column(String(500), nullable=False, comment="Worker端点地址")
    name = Column(String(200), comment="Worker名称")
    enabled = Column(Boolean, default=True, comment="是否启用")
    last_sync_at = Column(DateTime(timezone=True), comment="最后同步时间")
    sync_status = Column(String(50), default="pending", comment="同步状态")

    # 配置数据（从Worker推送）
    ua_configs = Column(JSON, comment="UA配置")
    ip_blacklist = Column(JSON, comment="IP黑名单")
    secret_usage = Column(JSON, comment="Secret使用统计")
    last_update = Column(BigInteger, comment="最后更新时间戳")

    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), comment="更新时间")

    def __repr__(self):
        return f"<WorkerConfig(worker_id='{self.worker_id}', endpoint='{self.endpoint}', enabled={self.enabled})>"

    def to_dict(self):
        """转换为字典"""
        return {
            "id": self.id,
            "worker_id": self.worker_id,
            "endpoint": self.endpoint,
            "name": self.name,
            "enabled": self.enabled,
            "last_sync_at": self.last_sync_at.isoformat() if self.last_sync_at else None,
            "sync_status": self.sync_status,
            "ua_configs": self.ua_configs or {},
            "ip_blacklist": self.ip_blacklist or [],
            "secret_usage": self.secret_usage or {},
            "last_update": self.last_update,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }

class SystemConfig(Base):
    """系统配置模型"""
    __tablename__ = "system_configs"
    
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(100), unique=True, index=True, nullable=False, comment="配置键")
    value = Column(Text, comment="配置值")
    description = Column(String(500), comment="配置描述")
    config_type = Column(String(50), default="string", comment="配置类型")
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), comment="更新时间")
    
    def __repr__(self):
        return f"<SystemConfig(key='{self.key}', value='{self.value}')>"
    
    def to_dict(self):
        """转换为字典"""
        return {
            "id": self.id,
            "key": self.key,
            "value": self.value,
            "description": self.description,
            "config_type": self.config_type,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }
