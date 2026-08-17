"""数据库高增长表容量预测测试。"""
from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.database import Base
from src.models_v2 import ApiCacheAccessLog, CleanupPolicy, ControlMessage
from src.services_v2 import db_stats_service


def _session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)(), engine


def test_capacity_forecast_uses_rolling_day_and_actual_retention(monkeypatch):
    db, engine = _session()
    current = datetime(2026, 8, 5, 12, 0, 0)
    recent = current - timedelta(hours=2)
    old = current - timedelta(days=2)
    db.add_all([
        ControlMessage(
            id=1, message_id="recent-control", direction="worker_to_local",
            message_type="cache.get", status="success", created_at=recent,
        ),
        ControlMessage(
            id=2, message_id="old-control", direction="worker_to_local",
            message_type="cache.get", status="success", created_at=old,
        ),
        ApiCacheAccessLog(
            id=1, cache_key="recent-cache", api_path="/api/v2/search/anime",
            access_type="hit", created_at=recent,
        ),
        CleanupPolicy(
            table_key="control_messages", display_name="长连接消息审计",
            enabled=True, retention_days=2,
        ),
        CleanupPolicy(
            table_key="api_cache_access_logs", display_name="缓存访问日志",
            enabled=True, retention_days=14,
        ),
    ])
    db.commit()
    monkeypatch.setattr(db_stats_service, "naive_now", lambda: current)
    stats = {
        "control_messages": {"row_count": 2, "size_bytes": 1000},
        "api_cache_access_logs": {"row_count": 1, "size_bytes": 300},
    }

    db_stats_service._capacity_forecasts(db, stats)

    control = stats["control_messages"]
    assert control["rows_24h"] == 1
    assert control["avg_row_bytes"] == 500.0
    assert control["daily_growth_bytes"] == 500
    assert control["retention_days"] == 2
    assert control["projected_retained_bytes"] == 1000
    assert control["forecast_ratio"] == 1.0
    assert control["forecast_available"] is True

    access = stats["api_cache_access_logs"]
    assert access["rows_24h"] == 1
    assert access["projected_retained_bytes"] == 4200
    assert access["forecast_ratio"] == 14.0
    db.close()
    engine.dispose()
