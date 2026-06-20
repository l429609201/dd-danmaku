"""
监控与访问控制相关 ORM 模型（S4/S5/S7）

- IpRule                 IP 黑白名单规则（下发给 Worker）
- IpRequestStatCurrent   IP 请求统计当前累计（Worker 周期上报 upsert）
- IpRequestStatSnapshot  IP 请求统计周期快照（用于趋势）
- WorkerRequestLog       Worker 请求/拦截日志（实时日志数据源）
"""
from sqlalchemy import (
    BigInteger, Boolean, Column, DateTime, Integer, JSON, String, Text,
    UniqueConstraint,
)

from src.models_v2.base import Base, TimestampMixin, now


class IpRule(Base, TimestampMixin):
    """IP 黑白名单规则"""
    __tablename__ = "ip_rules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ip_or_cidr = Column(String(100), unique=True, index=True, nullable=False)
    # black / white
    rule_type = Column(String(10), index=True, nullable=False)
    reason = Column(String(500), nullable=True)
    enabled = Column(Boolean, default=True, index=True, nullable=False)
    created_by = Column(String(80), nullable=True)
    # 可选临时封禁过期时间，为空表示长期有效
    expires_at = Column(DateTime, index=True, nullable=True)


class IpRequestStatCurrent(Base):
    """IP 请求统计当前累计状态（按 ip+worker 唯一 upsert）"""
    __tablename__ = "ip_request_stats_current"
    __table_args__ = (
        UniqueConstraint("ip", "worker_id", name="uq_ip_worker_current"),
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    ip = Column(String(64), index=True, nullable=False)
    worker_id = Column(String(100), index=True, nullable=False)
    total_count = Column(BigInteger, default=0, nullable=False)
    violation_count = Column(BigInteger, default=0, nullable=False)
    path_stats_json = Column(JSON, nullable=True)
    last_access_at = Column(DateTime, index=True, nullable=True)
    updated_at = Column(DateTime, default=now, index=True, nullable=False)


class IpRequestStatSnapshot(Base):
    """IP 请求统计周期快照（用于趋势/报表）"""
    __tablename__ = "ip_request_stats_snapshot"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    worker_id = Column(String(100), index=True, nullable=False)
    snapshot_at = Column(DateTime, default=now, index=True, nullable=False)
    ip = Column(String(64), index=True, nullable=False)
    total_count = Column(BigInteger, default=0, nullable=False)
    violation_count = Column(BigInteger, default=0, nullable=False)
    top_paths_json = Column(JSON, nullable=True)


class UaLimitRule(Base, TimestampMixin):
    """UA 限流规则（结构化配置，下发给 Worker 的 uaConfigs）"""
    __tablename__ = "ua_limit_rules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # uaConfigs 的 key，如 dandanplay / default
    ua_key = Column(String(80), unique=True, index=True, nullable=False)
    # UA 匹配子串（default 规则可为空）
    user_agent = Column(String(300), nullable=True)
    max_requests = Column(Integer, default=0, nullable=False)
    window_ms = Column(Integer, default=60000, nullable=False)
    # 路径限流：[{"path": "...", "maxRequestsPerHour": 50}]
    path_limits_json = Column(JSON, nullable=True)
    enabled = Column(Boolean, default=True, index=True, nullable=False)


class WorkerRequestLog(Base):
    """Worker 请求/拦截日志（实时日志数据源）"""
    __tablename__ = "worker_request_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    worker_id = Column(String(100), index=True, nullable=True)
    client_ip = Column(String(64), index=True, nullable=True)
    method = Column(String(10), nullable=True)
    path = Column(String(500), index=True, nullable=True)
    status = Column(Integer, index=True, nullable=True)
    ua_type = Column(String(100), index=True, nullable=True)
    # INFO / WARN / ERROR
    level = Column(String(20), index=True, nullable=False, default="INFO")
    message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=now, index=True, nullable=False)
