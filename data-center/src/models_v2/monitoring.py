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
    # Worker 对象格式字段：每小时/每天上限（-1 表示无限制），说明文字
    max_requests_per_hour = Column(Integer, nullable=True)
    max_requests_per_day = Column(Integer, nullable=True)
    description = Column(String(300), nullable=True)
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


class WorkerMetricsSnapshot(Base):
    """Worker 运行指标周期快照（每分钟一条/实例，仪表盘趋势数据源）

    指标含义为"上报窗口内增量"（请求/响应/流量/命中/拦截），
    便于按时间桶聚合；瞬时态（总请求、缓存规模）单独记录。
    """
    __tablename__ = "worker_metrics_snapshot"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    worker_id = Column(String(100), index=True, nullable=False)
    snapshot_at = Column(DateTime, default=now, index=True, nullable=False)
    # 流量与请求
    total_requests = Column(BigInteger, default=0, nullable=False)
    total_responses = Column(BigInteger, default=0, nullable=False)
    bytes_in = Column(BigInteger, default=0, nullable=False)
    bytes_out = Column(BigInteger, default=0, nullable=False)
    # 缓存命中
    mem_cache_hits = Column(BigInteger, default=0, nullable=False)
    r2_cache_hits = Column(BigInteger, default=0, nullable=False)
    cache_miss = Column(BigInteger, default=0, nullable=False)
    # 拦截
    blocked_ip = Column(BigInteger, default=0, nullable=False)
    blocked_ua = Column(BigInteger, default=0, nullable=False)
    blocked_abuse = Column(BigInteger, default=0, nullable=False)
    invalid_route = Column(BigInteger, default=0, nullable=False)
    upstream_429 = Column(BigInteger, default=0, nullable=False)
    # 状态码分布
    status_2xx = Column(BigInteger, default=0, nullable=False)
    status_4xx = Column(BigInteger, default=0, nullable=False)
    status_5xx = Column(BigInteger, default=0, nullable=False)
    # 瞬时态
    total_requests_lifetime = Column(BigInteger, default=0, nullable=False)
    api_cache_size = Column(Integer, default=0, nullable=False)


class LocalCommentStore(Base):
    """本地端弹幕兜底持久化存储元数据（实际弹幕体存文件系统）

    架构B：R2 为一级实时缓存，本地端为兜底持久化。
    以弹幕条数为准更新（新响应条数 >= 旧值才覆盖，避免残缺响应污染）。
    """
    __tablename__ = "local_comment_store"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    episode_id = Column(String(64), unique=True, index=True, nullable=False)
    # 弹幕 JSON 文件相对/绝对路径
    file_path = Column(String(500), nullable=False)
    size_bytes = Column(BigInteger, default=0, nullable=False)
    comment_count = Column(Integer, default=0, index=True, nullable=False)
    source = Column(String(50), default="r2_archive", nullable=False)
    created_at = Column(DateTime, default=now, index=True, nullable=False)
    updated_at = Column(DateTime, default=now, onupdate=now, nullable=False)
    last_used_at = Column(DateTime, index=True, nullable=True)


class CleanupPolicy(Base):
    """可配置数据清理策略：每个可清理表一条配置，前端可勾选/调保留天数

    cleanup_service 启动时确保默认策略存在，运行时按本表配置驱动清理。
    """
    __tablename__ = "cleanup_policy"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # 表标识（与 cleanup_service 的 TABLE_REGISTRY key 对应）
    table_key = Column(String(64), unique=True, index=True, nullable=False)
    display_name = Column(String(100), nullable=False)
    # 是否纳入清理
    enabled = Column(Boolean, default=False, nullable=False)
    # 保留天数（0 表示不按天清理）
    retention_days = Column(Integer, default=30, nullable=False)
    # 业务敏感标记：敏感表前端红色警示、默认关闭
    is_safe = Column(Boolean, default=True, nullable=False)
    # 仅清过期空壳（针对 api_response_cache 这类特殊清理模式）
    expired_only = Column(Boolean, default=False, nullable=False)
    last_cleanup_at = Column(DateTime, nullable=True)
    last_deleted = Column(BigInteger, default=0, nullable=False)
    updated_at = Column(DateTime, default=now, onupdate=now, nullable=False)
