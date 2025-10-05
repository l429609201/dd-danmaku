"""
统计数据模型
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, JSON, Float, BigInteger
from sqlalchemy.sql import func

from src.database import Base

class RequestStats(Base):
    """请求统计模型"""
    __tablename__ = "request_stats"
    
    id = Column(Integer, primary_key=True, index=True)
    worker_id = Column(String(100), index=True, comment="Worker标识")
    date_hour = Column(DateTime(timezone=True), index=True, comment="统计时间（小时）")
    
    # 请求统计
    total_requests = Column(BigInteger, default=0, comment="总请求数")
    successful_requests = Column(BigInteger, default=0, comment="成功请求数")
    blocked_requests = Column(BigInteger, default=0, comment="被阻止请求数")
    error_requests = Column(BigInteger, default=0, comment="错误请求数")
    
    # 响应时间统计
    avg_response_time = Column(Float, comment="平均响应时间（毫秒）")
    max_response_time = Column(Float, comment="最大响应时间（毫秒）")
    min_response_time = Column(Float, comment="最小响应时间（毫秒）")
    
    # 流量统计
    total_bytes_sent = Column(BigInteger, default=0, comment="发送字节数")
    total_bytes_received = Column(BigInteger, default=0, comment="接收字节数")
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), comment="更新时间")
    
    def __repr__(self):
        return f"<RequestStats(worker_id='{self.worker_id}', date_hour='{self.date_hour}', total={self.total_requests})>"
    
    def to_dict(self):
        """转换为字典"""
        return {
            "id": self.id,
            "worker_id": self.worker_id,
            "date_hour": self.date_hour.isoformat() if self.date_hour else None,
            "total_requests": self.total_requests,
            "successful_requests": self.successful_requests,
            "blocked_requests": self.blocked_requests,
            "error_requests": self.error_requests,
            "avg_response_time": self.avg_response_time,
            "max_response_time": self.max_response_time,
            "min_response_time": self.min_response_time,
            "total_bytes_sent": self.total_bytes_sent,
            "total_bytes_received": self.total_bytes_received,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }

class IPViolationStats(Base):
    """IP违规统计模型"""
    __tablename__ = "ip_violation_stats"
    
    id = Column(Integer, primary_key=True, index=True)
    worker_id = Column(String(100), index=True, comment="Worker标识")
    ip_address = Column(String(45), index=True, comment="IP地址")
    date_hour = Column(DateTime(timezone=True), index=True, comment="统计时间（小时）")
    
    # 违规统计
    violation_count = Column(Integer, default=0, comment="违规次数")
    violation_types = Column(JSON, comment="违规类型统计")
    
    # 封禁状态
    is_banned = Column(String(20), default="no", comment="封禁状态: no/temp/permanent")
    ban_start_time = Column(DateTime(timezone=True), comment="封禁开始时间")
    ban_end_time = Column(DateTime(timezone=True), comment="封禁结束时间")
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), comment="更新时间")
    
    def __repr__(self):
        return f"<IPViolationStats(ip='{self.ip_address}', violations={self.violation_count}, banned={self.is_banned})>"
    
    def to_dict(self):
        """转换为字典"""
        return {
            "id": self.id,
            "worker_id": self.worker_id,
            "ip_address": self.ip_address,
            "date_hour": self.date_hour.isoformat() if self.date_hour else None,
            "violation_count": self.violation_count,
            "violation_types": self.violation_types or {},
            "is_banned": self.is_banned,
            "ban_start_time": self.ban_start_time.isoformat() if self.ban_start_time else None,
            "ban_end_time": self.ban_end_time.isoformat() if self.ban_end_time else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }

class UAUsageStats(Base):
    """UA使用统计模型"""
    __tablename__ = "ua_usage_stats"
    
    id = Column(Integer, primary_key=True, index=True)
    worker_id = Column(String(100), index=True, comment="Worker标识")
    ua_config_name = Column(String(100), index=True, comment="UA配置名称")
    date_hour = Column(DateTime(timezone=True), index=True, comment="统计时间（小时）")
    
    # 使用统计
    request_count = Column(Integer, default=0, comment="请求次数")
    blocked_count = Column(Integer, default=0, comment="被阻止次数")
    success_rate = Column(Float, comment="成功率")
    
    # 路径统计
    path_stats = Column(JSON, comment="路径使用统计")
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), comment="更新时间")
    
    def __repr__(self):
        return f"<UAUsageStats(ua='{self.ua_config_name}', requests={self.request_count})>"
    
    def to_dict(self):
        """转换为字典"""
        return {
            "id": self.id,
            "worker_id": self.worker_id,
            "ua_config_name": self.ua_config_name,
            "date_hour": self.date_hour.isoformat() if self.date_hour else None,
            "request_count": self.request_count,
            "blocked_count": self.blocked_count,
            "success_rate": self.success_rate,
            "path_stats": self.path_stats or {},
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }
