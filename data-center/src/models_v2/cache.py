"""
API 响应缓存、实体索引与集数链接 ORM 模型（新架构核心）

- ApiResponseCache    上游 dandanplay 接口响应缓存主表（429 兜底数据源）
- ApiCacheAccessLog   缓存访问日志（命中/未命中/降级）
- ApiCacheRefreshTask 缓存刷新任务（等待 Worker 下次 200 刷新）
- ApiResponseEntity   anime/bangumi/episode 实体索引
- EpisodeLink         本地媒体与 dandanplay episode 的稳定链接

说明：响应体默认写入 Redis（storage_mode=redis），SQL 仅保存 redis_key 与元数据；
当 Redis 不可用时降级为 storage_mode=sql，response_body 落 SQL 冷备。
"""
from sqlalchemy import (
    BigInteger, Boolean, Column, DateTime, Integer, JSON, String, Text,
)

from src.models_v2.base import Base, TimestampMixin, now


class ApiResponseCache(Base, TimestampMixin):
    """上游 API 响应缓存主表"""
    __tablename__ = "api_response_cache"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    cache_key = Column(String(700), unique=True, index=True, nullable=False)
    source = Column(String(50), default="dandanplay", index=True, nullable=False)
    method = Column(String(10), index=True, nullable=False)
    api_path = Column(String(300), index=True, nullable=False)
    normalized_query = Column(String(1000), nullable=True)
    query_json = Column(JSON, nullable=True)
    request_body_hash = Column(String(100), index=True, nullable=True)
    request_body_json = Column(JSON, nullable=True)
    # 记录触发该缓存写入的客户端 IP（明文，便于直接排查来源）
    client_ip = Column(String(64), index=True, nullable=True)
    status_code = Column(Integer, index=True, nullable=False)
    response_headers_json = Column(JSON, nullable=True)
    # 响应体：默认放 Redis，这里允许为空；SQL 冷备模式下才写入
    response_body = Column(Text, nullable=True)
    # Redis key（sha256(cache_key) 派生），storage_mode=redis 时有效
    redis_key = Column(String(300), index=True, nullable=True)
    # redis / sql：响应体实际存储位置
    storage_mode = Column(String(30), default="redis", index=True, nullable=False)
    body_hash = Column(String(100), index=True, nullable=False)
    body_size = Column(Integer, default=0, nullable=False)
    fetched_at = Column(DateTime, index=True, nullable=False)
    last_used_at = Column(DateTime, index=True, nullable=True)
    last_refresh_at = Column(DateTime, index=True, nullable=True)
    refresh_after = Column(DateTime, index=True, nullable=False)
    expire_at = Column(DateTime, index=True, nullable=False)
    refresh_pending = Column(Boolean, default=False, index=True, nullable=False)
    hit_count = Column(Integer, default=0, nullable=False)
    stale_hit_count = Column(Integer, default=0, nullable=False)
    upstream_429_count = Column(Integer, default=0, nullable=False)


class ApiCacheAccessLog(Base):
    """缓存访问日志表"""
    __tablename__ = "api_cache_access_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    cache_key = Column(String(700), index=True, nullable=False)
    api_path = Column(String(300), index=True, nullable=False)
    # upsert / hit / miss / stale_hit / expired / 429
    access_type = Column(String(50), index=True, nullable=False)
    upstream_status = Column(Integer, nullable=True)
    served_status = Column(Integer, nullable=True)
    worker_request_id = Column(String(100), index=True, nullable=True)
    client_ip = Column(String(64), nullable=True)
    user_agent_type = Column(String(100), nullable=True)
    message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=now, index=True, nullable=False)


class ApiCacheRefreshTask(Base, TimestampMixin):
    """缓存刷新任务表"""
    __tablename__ = "api_cache_refresh_tasks"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    cache_key = Column(String(700), unique=True, index=True, nullable=False)
    api_path = Column(String(300), index=True, nullable=False)
    # stale_used / manual / periodic
    reason = Column(String(100), nullable=False)
    # pending / done / failed / cancelled
    status = Column(String(30), default="pending", index=True, nullable=False)
    attempts = Column(Integer, default=0, nullable=False)
    last_attempt_at = Column(DateTime, nullable=True)
    next_attempt_at = Column(DateTime, index=True, nullable=True)
    last_error = Column(Text, nullable=True)


class ApiResponseEntity(Base, TimestampMixin):
    """响应实体索引表"""
    __tablename__ = "api_response_entities"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    # anime / bangumi / episode
    entity_type = Column(String(50), index=True, nullable=False)
    entity_id = Column(String(100), index=True, nullable=False)
    title = Column(String(500), index=True, nullable=True)
    episode_title = Column(String(500), nullable=True)
    api_path = Column(String(300), index=True, nullable=False)
    cache_key = Column(String(700), index=True, nullable=False)
    raw_json = Column(JSON, nullable=True)
    first_seen_at = Column(DateTime, default=now, nullable=False)
    last_seen_at = Column(DateTime, default=now, index=True, nullable=False)


class EpisodeLink(Base, TimestampMixin):
    """集数链接表"""
    __tablename__ = "episode_links"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    local_title = Column(String(500), index=True, nullable=False)
    season_number = Column(Integer, index=True, nullable=True)
    episode_number = Column(String(50), index=True, nullable=True)
    episode_title = Column(String(500), nullable=True)
    file_name_hash = Column(String(100), index=True, nullable=True)
    dandan_anime_id = Column(String(100), index=True, nullable=True)
    dandan_bangumi_id = Column(String(100), index=True, nullable=True)
    dandan_episode_id = Column(String(100), index=True, nullable=False)
    anime_title = Column(String(500), nullable=True)
    # search_anime / search_episodes / bangumi / match / manual
    match_source = Column(String(50), index=True, nullable=False)
    confidence = Column(Integer, default=0, nullable=False)
    source_cache_key = Column(String(700), index=True, nullable=False)
    bangumi_cache_key = Column(String(700), index=True, nullable=True)
    comment_api_path = Column(String(300), nullable=True)
    comment_cache_key = Column(String(700), index=True, nullable=True)
    is_manual = Column(Boolean, default=False, nullable=False)
    verified_by_user_id = Column(Integer, index=True, nullable=True)
    last_used_at = Column(DateTime, index=True, nullable=True)


class MediaLibrary(Base, TimestampMixin):
    """媒体信息库：从搜索/番剧响应抽取的番剧级媒体信息（海报/类型/简介等）

    与 api_response_entities（碎片去重索引）不同，本表是面向展示的番剧主档，
    以 dandan_anime_id 为唯一键，聚合海报、类型、总集数等元信息，供媒体库页使用。
    """
    __tablename__ = "media_library"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    anime_id = Column(String(100), unique=True, index=True, nullable=False)
    title = Column(String(500), index=True, nullable=True)
    # 原始海报 URL（dandanplay imageUrl，展示时走本地代理避免防盗链）
    image_url = Column(String(1000), nullable=True)
    type_code = Column(String(50), nullable=True)
    type_desc = Column(String(100), nullable=True)
    summary = Column(Text, nullable=True)
    rating = Column(String(50), nullable=True)
    start_date = Column(String(50), nullable=True)
    # 上游声明的总集数（来自 search 的 episodeCount 或 bangumi 的 episodes 长度）
    episode_count = Column(Integer, default=0, nullable=False)
    # 数据来源：search_anime / bangumi
    source = Column(String(50), index=True, nullable=True)
    first_seen_at = Column(DateTime, default=now, nullable=False)
    last_seen_at = Column(DateTime, default=now, index=True, nullable=False)
