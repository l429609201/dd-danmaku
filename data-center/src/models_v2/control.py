"""
系统设置、Worker 控制通道与运行审计 ORM 模型

- AppSetting       本地端运行配置（含 Worker 控制 token、缓存策略等）
- ControlNode      本地端与 Worker ControlHub 的长连接节点状态
- ControlMessage   长连接 RPC 消息审计（替代旧同步日志表）
- RuntimeEvent     本地端统一运行事件（替代旧 SystemLog / SyncLog）
"""
from sqlalchemy import (
    BigInteger, Boolean, Column, DateTime, Integer, JSON, String, Text,
)

from src.models_v2.base import Base, TimestampMixin, now


class AppSetting(Base, TimestampMixin):
    """系统设置表（key-value）"""
    __tablename__ = "app_settings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    key = Column(String(100), unique=True, index=True, nullable=False)
    value = Column(Text, nullable=True)
    # string/int/bool/json/secret
    value_type = Column(String(30), default="string", nullable=False)
    description = Column(String(500), nullable=True)
    is_secret = Column(Boolean, default=False, nullable=False)


class ControlNode(Base, TimestampMixin):
    """Worker 长连接节点状态表"""
    __tablename__ = "control_nodes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    node_id = Column(String(100), unique=True, index=True, nullable=False)
    worker_id = Column(String(100), index=True, nullable=False)
    worker_url = Column(String(500), nullable=False)
    connected = Column(Boolean, default=False, nullable=False)
    connection_id = Column(String(100), nullable=True)
    protocol_version = Column(String(50), default="v1", nullable=False)
    client_version = Column(String(50), nullable=True)
    last_connected_at = Column(DateTime, nullable=True)
    last_seen_at = Column(DateTime, index=True, nullable=True)
    latency_ms = Column(Integer, default=0, nullable=False)
    reconnect_count = Column(Integer, default=0, nullable=False)
    last_error = Column(Text, nullable=True)
    extra_json = Column(JSON, nullable=True)


class ControlMessage(Base, TimestampMixin):
    """长连接消息审计表"""
    __tablename__ = "control_messages"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    message_id = Column(String(100), unique=True, index=True, nullable=False)
    node_id = Column(String(100), index=True, nullable=True)
    # worker_to_local / local_to_worker / internal
    direction = Column(String(30), index=True, nullable=False)
    # cache.get / cache.upsert / config.apply / r2.comment.get 等
    message_type = Column(String(80), index=True, nullable=False)
    # pending / success / failed / timeout
    status = Column(String(30), index=True, default="pending", nullable=False)
    request_cache_key = Column(String(700), index=True, nullable=True)
    # 载荷摘要，禁止存大响应体
    payload_summary = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    duration_ms = Column(Integer, default=0, nullable=False)


class RuntimeEvent(Base):
    """本地端运行事件表"""
    __tablename__ = "runtime_events"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    # INFO / WARN / ERROR
    level = Column(String(20), index=True, nullable=False)
    # control / cache / config / system
    category = Column(String(80), index=True, nullable=False)
    event = Column(String(120), index=True, nullable=False)
    message = Column(Text, nullable=False)
    details_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=now, index=True, nullable=False)
