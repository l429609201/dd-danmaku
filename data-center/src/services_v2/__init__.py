"""
services_v2：本地端全新业务服务包

旧 services（worker_sync/stats_service/config_service 等同步逻辑）废弃，
本包围绕新架构：Redis 热缓存、响应缓存、实体索引、集数链接、运行事件、用户认证。
"""
from src.services_v2.redis_cache import redis_cache, RedisCacheService
from src.services_v2.runtime_event_service import runtime_event_service, RuntimeEventService
from src.services_v2.auth_service import auth_service_v2, AuthServiceV2
from src.services_v2.cache_service import cache_service, CacheService
from src.services_v2.cleanup_service import cleanup_service, CleanupService
from src.services_v2.entity_service import (
    entity_index_service, EntityIndexService,
    episode_link_service, EpisodeLinkService,
)

__all__ = [
    "redis_cache", "RedisCacheService",
    "runtime_event_service", "RuntimeEventService",
    "auth_service_v2", "AuthServiceV2",
    "cache_service", "CacheService",
    "cleanup_service", "CleanupService",
    "entity_index_service", "EntityIndexService",
    "episode_link_service", "EpisodeLinkService",
]
