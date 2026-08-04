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
    # 绑定的签名密钥组 group_id（关联 SignKeyPool.group_id）；空=不启用签名验证
    sign_group_id = Column(String(64), nullable=True)
    # 绑定的用户允许组 group_id（关联 UserAllowPool.group_id）；空=不启用用户名过滤
    # 校验顺序：实例校验 → 用户名过滤 → 签名验证
    user_group_id = Column(String(64), nullable=True)
    # 实例 ID 校验参数已移入 UserAllowPool（通过 user_group_id 引用）
    # 删除本表的 instance_brand_mark / instance_obf_key，保持与签名组对称

    # ---------- 回源限流（origin_*）----------
    # 与上面的「请求限流」是两回事：上面限「客户端打 Worker 的频率」，
    # 这里限「Worker 真正回源打弹弹play 的次数」——后者才对应付费配额。
    # 缓存命中不会走到回源检查，所以命中不再消耗上游配额。
    # 计数维度：UA + IP（与请求侧一致），-1 表示无限制。
    origin_limit_enabled = Column(Boolean, default=False, nullable=False)
    origin_max_per_hour = Column(Integer, nullable=True)
    origin_max_per_day = Column(Integer, nullable=True)
    # 回源侧路径级配额，结构同 path_limits_json：[{"path": "...", "maxRequestsPerHour": 50}]
    origin_path_limits_json = Column(JSON, nullable=True)


class WorkerRequestLog(Base):
    """Worker 请求/拦截日志（实时日志数据源）"""
    __tablename__ = "worker_request_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    worker_id = Column(String(100), index=True, nullable=True)
    client_ip = Column(String(64), index=True, nullable=True)
    method = Column(String(10), nullable=True)
    path = Column(String(500), index=True, nullable=True)
    # 提取 URL 参数中的搜索词/episodeId，便于日志查看和筛选
    # （GET 请求参数在 query 而非 body，Worker 侧从 tUrlObj.searchParams 提取）
    query = Column(String(500), nullable=True)
    status = Column(Integer, index=True, nullable=True)
    ua_type = Column(String(100), index=True, nullable=True)
    # 缓存来源：MEM / LOCAL / R2 / MISS / KEY-POOL 等（便于排查命中链路）
    cache_source = Column(String(20), index=True, nullable=True)
    # 上游响应状态（软限流时记录真实 errorCode）
    upstream_status = Column(Integer, nullable=True)
    # 本次请求使用的密钥 id（密钥池调度排查）
    key_id = Column(String(64), nullable=True)
    # 客户端用户标识（X-Ddd-User，来自客户端签名头，用于按用户标识/过滤）
    # 长度 255：上报的是**混淆后**的标识（`品牌:GUID` 经 hex 编码后约 96 字符），
    # 原 64 会溢出导致整批日志落库失败（见 database_patches._patch_widen_client_user_id）
    client_user_id = Column(String(255), index=True, nullable=True)
    # 请求处理耗时（毫秒）
    duration_ms = Column(Integer, nullable=True)
    # 响应体字节数（缓存命中/回源均记录，拦截类为 None）
    response_bytes = Column(Integer, nullable=True)
    # 请求体内容（POST/PUT 截断至 4 KB，GET 为 None）
    request_body = Column(Text, nullable=True)
    # 响应体内容（截断至 4 KB，拦截类早退路径为 None）
    response_body = Column(Text, nullable=True)
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


class AppKeyPool(Base, TimestampMixin):
    """弹弹play 密钥池：本地端维护并下发给 Worker 作为扩充

    authUaKeys 为空 => 公共轮换池；非空 => 仅授权给这些 ua_key 的请求。
    Worker 合并 env 基线 + 本地端下发，按 appId+appSecret 去重，本地端为主。
    """
    __tablename__ = "app_key_pool"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # 逻辑标识（下发给 Worker 作为 key id，限流状态以此为键）
    key_id = Column(String(64), unique=True, index=True, nullable=False)
    app_id = Column(String(100), nullable=False)
    app_secret = Column(String(200), nullable=False)
    # 授权 ua_key 列表（关联 UaLimitRule.ua_key），空数组=公共池
    auth_ua_keys = Column(JSON, default=list, nullable=False)
    # 转发官方 API 时使用的 User-Agent：空=转发请求者原始 UA，非空=用此 UA 覆盖
    forward_ua = Column(String(300), nullable=True)
    enabled = Column(Boolean, default=True, index=True, nullable=False)
    remark = Column(String(500), nullable=True)


class SignKeyPool(Base, TimestampMixin):
    """客户端签名密钥池：本地端维护并下发给 Worker 用于验签

    每组 secret 需与某个内置该密钥、独立编译的 ede.js/sign.wasm 发布版一致。
    auth_ua_keys 为空 => 公共组（所有需验签 UA 通用）；非空 => 仅这些 ua_key 用该组验证。
    Worker 按 UA 找对应组，逐个 secret 尝试验证，任一通过即放行。
    """
    __tablename__ = "sign_key_pool"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # 逻辑标识（下发给 Worker 作为组 id，UA 规则通过它绑定本组）
    group_id = Column(String(64), unique=True, index=True, nullable=False)
    # 该组签名密钥（与对应 wasm 内置 SIGN_SECRET 一致）
    secret = Column(String(200), nullable=False)
    enabled = Column(Boolean, default=True, index=True, nullable=False)
    remark = Column(String(500), nullable=True)


class UserAllowPool(Base, TimestampMixin):
    """用户允许名单池：本地端维护并下发给 Worker 用于用户名过滤

    每组维护一批允许访问的客户端用户名（X-Ddd-User 头的值）。
    UA 规则通过 user_group_id 绑定本组；空组（users_json 为空列表）等同于「允许所有用户」，
    不应与「不配置 user_group_id（不校验）」混淆。

    校验顺序（Worker 主流程）：[本组实例 ID 校验（brand_mark+obf_key 均配置时）] → 本组用户名校验 → 签名校验
    """
    __tablename__ = "user_allow_pool"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # 逻辑标识（下发给 Worker 作为组 id，UA 规则通过 user_group_id 绑定）
    group_id = Column(String(64), unique=True, index=True, nullable=False)
    # 允许的用户名列表（精确匹配 X-Ddd-User 值）；空列表 = 拒绝所有用户
    users_json = Column(JSON, default=list, nullable=False)
    # 实例 ID 归属校验：两者均配置时对 X-Ddd-Instance 做 XOR 反解并比对前缀
    # brand_mark: 期望的品牌标记（如 misaka10876），空=不做实例校验
    brand_mark = Column(String(100), nullable=True)
    # obf_key: XOR 混淆密钥（sha256(obf_key) 循环扩展），与弹幕库 OBF_KEY 保持一致
    obf_key = Column(String(200), nullable=True)
    enabled = Column(Boolean, default=True, index=True, nullable=False)
    remark = Column(String(500), nullable=True)


class WorkerKeyState(Base):
    """Worker 上报的密钥限流状态快照（每 worker 一条，覆盖更新）

    key_state: { keyId: { apiGroup: { limited, limitedAt } } }
    供前端展示每个密钥在各接口的当日限流情况。
    """
    __tablename__ = "worker_key_state"

    id = Column(Integer, primary_key=True, autoincrement=True)
    worker_id = Column(String(100), unique=True, index=True, nullable=False)
    reset_date = Column(String(20), nullable=True)
    keys_source = Column(String(20), nullable=True)
    key_count = Column(Integer, default=0, nullable=False)
    key_state = Column(JSON, default=dict, nullable=False)
    updated_at = Column(DateTime, default=now, onupdate=now, index=True, nullable=False)


class OAuthConfig(Base, TimestampMixin):
    """OAuth 配置：本地端维护并通过长连接下发给 Worker

    与 env.OAUTH_CONFIG 的关系：
    - 本表是「可编辑的配置源」，改动经 config.apply 存入 DO storage；
    - Worker 侧 getOAuthConfig 优先读下发值，env 仅作冷启动兜底，
      因此本表留空/未下发时行为与改造前完全一致（灰度安全）。

    字段与 Worker 侧 OAUTH_CONFIG 的 JSON 结构一一对应，下发时不做结构转换。
    同一时刻只取一条 enabled=True 记录生效（多条时按 id 最小者，避免歧义）。
    """
    __tablename__ = "oauth_config"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # 是否启用 OAuth（对应 JSON enabled）；false 时 Worker 走「OAuth 未启用」分支
    enabled = Column(Boolean, default=False, index=True, nullable=False)
    # JWT 签名密钥（对应 jwtSecret）——敏感，接口返回时需脱敏
    jwt_secret = Column(String(500), nullable=False, default="")
    # JWT 有效期（小时，对应 jwtExpireHours；Worker 默认 720=30天）
    jwt_expire_hours = Column(Integer, default=720, nullable=False)
    # 允许登录的用户（对应 allowedUsers），格式 {"用户名": true}
    allowed_users_json = Column(JSON, default=dict, nullable=False)
    # 各 provider 配置（对应 providers），格式
    # {"github": {clientId, clientSecret, authorizeUrl, tokenUrl, userInfoUrl, scope}}
    # 其中 clientSecret 敏感，接口返回时需脱敏
    providers_json = Column(JSON, default=dict, nullable=False)
    remark = Column(String(500), nullable=True)


class IpGeoCache(Base):
    """IP 地理解析结果持久化缓存（ip 唯一）

    GeoLite2 解析结果落库，避免每次打开地图重复解析：
    - resolved=True：已成功解析，存经纬度/城市/国家
    - resolved=False：解析失败（私有IP/未收录），记录以跳过重复尝试
    每次聚合只对「未入此表的新 IP」解析，已存的直接读表。
    """
    __tablename__ = "ip_geo_cache"

    ip = Column(String(64), primary_key=True)
    lng = Column(String(20), nullable=True)
    lat = Column(String(20), nullable=True)
    city = Column(String(120), nullable=True)
    country = Column(String(8), nullable=True)
    # 是否解析成功（False 表示无法定位，记录避免重复 lookup）
    resolved = Column(Boolean, default=False, index=True, nullable=False)
    resolved_at = Column(DateTime, default=now, nullable=False)
