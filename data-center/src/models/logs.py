"""
日志数据模型
"""
from datetime import datetime
from sqlalchemy import Column, Integer, BigInteger, String, DateTime, Text, JSON
from sqlalchemy.sql import func

from src.database import Base

class SystemLog(Base):
    """系统日志模型"""
    __tablename__ = "system_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    worker_id = Column(String(100), index=True, comment="Worker标识")
    level = Column(String(20), index=True, comment="日志级别")
    message = Column(Text, comment="日志消息")
    details = Column(JSON, comment="详细信息")
    
    # 分类信息
    category = Column(String(50), index=True, comment="日志分类")
    source = Column(String(100), comment="日志来源")
    
    # 请求相关信息
    request_id = Column(String(100), index=True, comment="请求ID")
    ip_address = Column(String(45), index=True, comment="IP地址")
    user_agent = Column(String(500), comment="User-Agent")
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True, comment="创建时间")
    
    def __repr__(self):
        return f"<SystemLog(level='{self.level}', message='{self.message[:50]}...', created_at='{self.created_at}')>"
    
    def to_dict(self):
        """转换为字典"""
        return {
            "id": self.id,
            "worker_id": self.worker_id,
            "level": self.level,
            "message": self.message,
            "details": self.details or {},
            "category": self.category,
            "source": self.source,
            "request_id": self.request_id,
            "ip_address": self.ip_address,
            "user_agent": self.user_agent,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }

class TelegramLog(Base):
    """Telegram机器人日志模型"""
    __tablename__ = "telegram_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(BigInteger, index=True, comment="用户ID")  # Telegram user_id 可能超过 Integer 范围
    username = Column(String(100), comment="用户名")
    command = Column(String(200), comment="执行的命令")
    response = Column(Text, comment="机器人响应")
    
    # 执行状态
    status = Column(String(20), default="success", comment="执行状态")
    error_message = Column(Text, comment="错误消息")
    
    # 执行时间
    execution_time = Column(Integer, comment="执行时间（毫秒）")
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True, comment="创建时间")
    
    def __repr__(self):
        return f"<TelegramLog(user_id={self.user_id}, command='{self.command}', status='{self.status}')>"
    
    def to_dict(self):
        """转换为字典"""
        return {
            "id": self.id,
            "user_id": self.user_id,
            "username": self.username,
            "command": self.command,
            "response": self.response,
            "status": self.status,
            "error_message": self.error_message,
            "execution_time": self.execution_time,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }

class SyncLog(Base):
    """同步日志模型"""
    __tablename__ = "sync_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    worker_id = Column(String(100), index=True, comment="Worker标识")
    sync_type = Column(String(50), comment="同步类型")
    direction = Column(String(20), comment="同步方向: push/pull")
    
    # 同步状态
    status = Column(String(20), default="pending", comment="同步状态")
    error_message = Column(Text, comment="错误消息")
    
    # 同步数据
    data_size = Column(Integer, comment="数据大小（字节）")
    records_count = Column(Integer, comment="记录数量")
    
    # 时间信息
    started_at = Column(DateTime(timezone=True), comment="开始时间")
    completed_at = Column(DateTime(timezone=True), comment="完成时间")
    duration = Column(Integer, comment="持续时间（毫秒）")
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True, comment="创建时间")
    
    def __repr__(self):
        return f"<SyncLog(worker_id='{self.worker_id}', type='{self.sync_type}', status='{self.status}')>"
    
    def to_dict(self):
        """转换为字典"""
        return {
            "id": self.id,
            "worker_id": self.worker_id,
            "sync_type": self.sync_type,
            "direction": self.direction,
            "status": self.status,
            "error_message": self.error_message,
            "data_size": self.data_size,
            "records_count": self.records_count,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "duration": self.duration,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }
