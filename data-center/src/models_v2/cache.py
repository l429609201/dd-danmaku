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
    BigInteger, Boolean, Column, DateTime, Index, Integer, JSON, String, Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.mysql import MEDIUMTEXT

from src.models_v2.base import Base, TimestampMixin, now


class ApiResponseCache(Base, TimestampMixin):
    """上游 API 响应缓存主表"""
    __tablename__ = "api_response_cache"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    cache_key = Column(String(700), unique=True, index=True, nullable=False)
    # 以下列不做查询条件（source/method/status_code 低区分度，body_hash/redis_key
    # 仅取值不 filter），去掉索引以降低写放大——每次 upsert 少维护多棵索引树
    source = Column(String(50), default="dandanplay", nullable=False)
    method = Column(String(10), nullable=False)
    api_path = Column(String(300), index=True, nullable=False)
    normalized_query = Column(String(1000), nullable=True)
    query_json = Column(JSON, nullable=True)
    request_body_hash = Column(String(100), nullable=True)
    request_body_json = Column(JSON, nullable=True)
    # 记录触发该缓存写入的客户端 IP（明文，便于直接排查来源）
    # 仅 LIKE '%ip%' 模糊查，前置通配符用不上索引，去掉
    client_ip = Column(String(64), nullable=True)
    status_code = Column(Integer, nullable=False)
    response_headers_json = Column(JSON, nullable=True)
    # 响应体：默认放 Redis，这里允许为空；SQL 冷备模式下才写入
    # MEDIUMTEXT(16MB) 而非 TEXT(64KB)：搜索类接口响应常超 64KB，
    # 用 TEXT 会导致 cache.upsert 报 1406 写失败，Redis 淘汰后缓存变空壳。
    # 见 database_patches._patch_widen_cache_response_body
    response_body = Column(Text().with_variant(MEDIUMTEXT, "mysql"), nullable=True)
    # Redis key（sha256(cache_key) 派生），storage_mode=redis 时有效；仅取值不 filter
    redis_key = Column(String(300), nullable=True)
    # redis / sql：响应体实际存储位置（仅低频后台统计用，去掉索引）
    storage_mode = Column(String(30), default="redis", nullable=False)
    body_hash = Column(String(100), nullable=False)
    body_size = Column(Integer, default=0, nullable=False)
    fetched_at = Column(DateTime, index=True, nullable=False)
    last_used_at = Column(DateTime, nullable=True)
    last_refresh_at = Column(DateTime, nullable=True)
    refresh_after = Column(DateTime, index=True, nullable=False)
    expire_at = Column(DateTime, index=True, nullable=False)
    refresh_pending = Column(Boolean, default=False, index=True, nullable=False)
    hit_count = Column(Integer, default=0, nullable=False)
    stale_hit_count = Column(Integer, default=0, nullable=False)
    upstream_429_count = Column(Integer, default=0, nullable=False)
    # 空结果负缓存标记：True 表示上游真实返回空（search animes 为空，非 429/失败），
    # 用于挡重复无效搜索。管理页单独分页展示，可配独立 TTL。
    is_empty = Column(Boolean, default=False, index=True, nullable=False)


class ApiCacheAccessLog(Base):
    """缓存访问日志表"""
    __tablename__ = "api_cache_access_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    # cache_key 仅 LIKE '%x%' 模糊查（用不上索引），api_path 不做条件，去掉索引
    cache_key = Column(String(700), nullable=False)
    api_path = Column(String(300), nullable=False)
    # upsert / hit / miss / stale_hit / expired / 429（按 access_type 过滤统计，保留）
    access_type = Column(String(50), index=True, nullable=False)
    upstream_status = Column(Integer, nullable=True)
    served_status = Column(Integer, nullable=True)
    worker_request_id = Column(String(100), nullable=True)
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
    """响应实体索引表

    「化整为零」的落点：上游整季响应在此按 anime / bangumi / episode 拆成独立行，
    后续可由 entity_assemble 反向「从零拼整」，避免带 episode=N 时每集各回源一次。
    """
    __tablename__ = "api_response_entities"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    # anime / bangumi / episode
    entity_type = Column(String(50), index=True, nullable=False)
    entity_id = Column(String(100), index=True, nullable=False)
    # title 仅 LIKE '%x%' 模糊查（用不上索引），api_path/cache_key 不做条件，去掉索引
    title = Column(String(500), nullable=True)
    episode_title = Column(String(500), nullable=True)
    # episode 实体所属番剧 ID。显式存储而非从 episodeId 推算：
    # 现网规律是 episodeId = animeId * 10000 + 集号，但超过 9999 集或特殊编号会破裂，
    # 解析 /bangumi/{id} 时父级已带 animeId，直接取即可，不做算术反推。
    anime_id = Column(String(100), nullable=True)
    # 集号（上游 episodeNumber 原样保留字符串，可能是 "7" / "SP1" / "OVA"）
    episode_number = Column(String(50), nullable=True)
    api_path = Column(String(300), nullable=False)
    cache_key = Column(String(700), nullable=False)
    raw_json = Column(JSON, nullable=True)
    first_seen_at = Column(DateTime, default=now, nullable=False)
    last_seen_at = Column(DateTime, default=now, index=True, nullable=False)

    __table_args__ = (
        # (entity_type, entity_id) 是业务唯一键，加约束防并发写入产生重复行
        UniqueConstraint("entity_type", "entity_id", name="uq_are_type_id"),
        # 拼装整季 / 取指定集的主查询路径
        Index("ix_are_anime_ep", "entity_type", "anime_id", "episode_number"),
    )


class EpisodeLink(Base, TimestampMixin):
    """集数链接表"""
    __tablename__ = "episode_links"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    # local_title 仅 LIKE '%x%'（用不上索引），去掉
    local_title = Column(String(500), nullable=False)
    # season/episode_number/file_name_hash 不做查询条件，去掉索引
    season_number = Column(Integer, nullable=True)
    episode_number = Column(String(50), nullable=True)
    episode_title = Column(String(500), nullable=True)
    file_name_hash = Column(String(100), nullable=True)
    dandan_anime_id = Column(String(100), index=True, nullable=True)
    dandan_bangumi_id = Column(String(100), index=True, nullable=True)
    dandan_episode_id = Column(String(100), index=True, nullable=False)
    anime_title = Column(String(500), nullable=True)
    # search_anime / search_episodes / bangumi / match / manual
    match_source = Column(String(50), index=True, nullable=False)
    confidence = Column(Integer, default=0, nullable=False)
    # 以下 cache_key 类列仅存储不 filter，去掉索引
    source_cache_key = Column(String(700), nullable=False)
    bangumi_cache_key = Column(String(700), nullable=True)
    comment_api_path = Column(String(300), nullable=True)
    comment_cache_key = Column(String(700), nullable=True)
    is_manual = Column(Boolean, default=False, nullable=False)
    verified_by_user_id = Column(Integer, nullable=True)
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



class MediaExternalId(Base, TimestampMixin):
    """番剧的外部平台 ID 索引（Bangumi.tv / AniDB / TMDB / IMDb / ...）

    数据来源：dandanplay /bangumi/{id} 响应里的 onlineDatabases[]，
    该数组已给出各平台完整 URL，正则提取 ID 即可，无需请求外部服务。

    provider 刻意用自由文本而非 Enum：新增平台只写数据不改代码，
    正则匹配不到的平台（如 Notify.moe）也照样入库，只留 external_url 不丢数据。
    """
    __tablename__ = "media_external_ids"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    # dandanplay animeId，关联 media_library.anime_id
    anime_id = Column(String(100), index=True, nullable=False)
    # 平台标识：bangumi_tv / anidb / mal / tmdb / imdb / tvdb / anilist / ...
    provider = Column(String(50), nullable=False)
    # 从 URL 提取的 ID（617123 / tt39246964 / anime-planet 的 slug）；提取失败留空
    external_id = Column(String(200), nullable=True)
    # 原始 URL，前端直接跳转，也是提取失败时的兜底
    external_url = Column(String(500), nullable=True)
    # auto（脚本从 onlineDatabases 提取）/ manual（人工填写，增量脚本不覆盖）
    source = Column(String(30), default="auto", nullable=False)
    confidence = Column(Integer, default=0, nullable=False)

    __table_args__ = (
        # 一部番在同一平台只有一个 ID，加约束防并发写入产生重复行
        UniqueConstraint("anime_id", "provider", name="uq_mei_anime_provider"),
        # 反查路径：已知 TMDB ID 找对应的 dandanplay 条目
        Index("ix_mei_provider_extid", "provider", "external_id"),
    )


class MediaAlias(Base, TimestampMixin):
    """番剧别名表：统一承载所有来源的「别名 → animeId」映射

    刻意不拆成两张表（官方别名 / 搜索词映射）——两者本质都是别名到
    animeId 的映射，查询逻辑相同，用 source 区分来源、status 控制是否生效即可，
    线上解析只查一张表。

    只有 status=approved 参与线上解析；auto_match / bgm / tmdb 一律先 pending，
    人工确认后才生效，避免算法误判直接影响线上搜索。
    """
    __tablename__ = "media_alias"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    # 归属的 dandanplay animeId
    anime_id = Column(String(100), index=True, nullable=False)
    alias = Column(String(500), nullable=False)
    # 归一化形式（NFKC + 小写 + 连续空白合一），线上查询走这列而非 alias
    alias_norm = Column(String(500), nullable=False)
    # 再去掉所有空白的形态：用户手输标题时空格位置随意
    # （「无职转生Ⅱ ～…～」vs「无职转生ii～…～」），alias_norm 保留单个空格
    # 会导致精确匹配失配。单独存一列并建索引，避免查询时用
    # REPLACE() 导致全表扫描。alias_norm 不改动——它还承担唯一键与展示职责。
    alias_norm_ns = Column(String(500), nullable=True)
    # zh-Hans / zh-Hant / ja / ja-romaji / en / unknown
    lang = Column(String(50), nullable=True)
    # main（主标题）/ official / alias / search_keyword
    title_type = Column(String(30), nullable=True)
    # dandanplay_titles / cache_extract_1 / cache_extract_n / auto_match
    # / bgm / tmdb / manual
    source = Column(String(30), nullable=False)
    # approved（线上生效）/ pending（待人工确认）/ rejected
    status = Column(String(20), default="pending", nullable=False)
    confidence = Column(Integer, default=0, nullable=False)
    # 录入时该搜索词的命中次数，人工校验页按此降序（命中越多修好收益越大）
    hit_snapshot = Column(Integer, default=0, nullable=False)
    verified_by = Column(Integer, nullable=True)
    # AI 给出的建议：{match_index, confidence, reason}，仅作人工判断参考
    ai_suggestion = Column(JSON, nullable=True)
    ai_called_at = Column(DateTime, nullable=True)

    __table_args__ = (
        # 同一别名不能重复挂到同一番剧上
        UniqueConstraint("alias_norm", "anime_id", name="uq_ma_norm_anime"),
        # 线上解析主查询路径：按归一化别名 + approved 状态查
        Index("ix_ma_norm_status", "alias_norm", "status"),
        # 空格差异兜底查询路径：精确匹配失配后按无空白形态 + approved 查
        Index("ix_ma_normns_status", "alias_norm_ns", "status"),
        # 人工校验页排序路径：pending 按命中数降序
        Index("ix_ma_status_hit", "status", "hit_snapshot"),
    )
