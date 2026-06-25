"""
models_v2：本地端全新 ORM 模型包

旧 models 包（config/stats/logs/web_config/auth）全部废弃，不再导入。
本包统一通过 src.database.Base 注册所有新表，
init_db 时只需导入本包即可让 create_all 创建全部 v2 表。
"""
from src.models_v2.base import Base, TimestampMixin, now
from src.models_v2.users import (
    LocalUser, LocalLoginSession, LocalApiToken,
)
from src.models_v2.control import (
    AppSetting, ControlNode, ControlMessage, RuntimeEvent,
)
from src.models_v2.cache import (
    ApiResponseCache, ApiCacheAccessLog, ApiCacheRefreshTask,
    ApiResponseEntity, EpisodeLink,
)
from src.models_v2.monitoring import (
    IpRule, IpRequestStatCurrent, IpRequestStatSnapshot,
    UaLimitRule, WorkerRequestLog, WorkerMetricsSnapshot, LocalCommentStore,
    CleanupPolicy,
)

__all__ = [
    "Base",
    "TimestampMixin",
    "now",
    # 用户控制
    "LocalUser",
    "LocalLoginSession",
    "LocalApiToken",
    # 设置 / 控制 / 审计
    "AppSetting",
    "ControlNode",
    "ControlMessage",
    "RuntimeEvent",
    # 缓存 / 实体 / 集数链接
    "ApiResponseCache",
    "ApiCacheAccessLog",
    "ApiCacheRefreshTask",
    "ApiResponseEntity",
    "EpisodeLink",
    # 监控 / 访问控制
    "IpRule",
    "IpRequestStatCurrent",
    "IpRequestStatSnapshot",
    "UaLimitRule",
    "WorkerRequestLog",
    "WorkerMetricsSnapshot",
    "LocalCommentStore",
    "CleanupPolicy",
]
