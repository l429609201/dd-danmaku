"""
外部控制 API（External Control API）

统一供 MCP / 外部诊断工具调用，独立密钥鉴权（X-External-Token）。
**全部为只读**：用于观测运行健康度、查数据、查日志、定位性能瓶颈，
不提供任何写操作（配置下发 / 清理 / 缓存失效请走管理后台，避免误操作）。

所有端点均依赖 verify_external_token，与用户登录 JWT 完全隔离。

注意：各端点的 docstring 会被 mcp_http.py 自动提取为 MCP 工具说明（给 AI 看），
函数签名会被反射成入参 schema。所以 docstring 要写清「怎么读、什么算异常」，
新增端点后只需在 mcp_http.py 的 _TOOL_HANDLERS 登记一行。
"""
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query

from src.api.v2.deps import verify_external_token, require_admin
from src.api.v2.schemas import ApiResult
from src.database import engine
from src.models_v2 import LocalUser

logger = logging.getLogger(__name__)
router = APIRouter()


# ========== 密钥管理（走用户 JWT admin，供前端查看/生成/轮换） ==========
@router.get("/token")
async def get_external_token(_: LocalUser = Depends(require_admin)):
    """查看当前外部控制密钥明文（admin 专用；无则自动生成）"""
    from src.services_v2.external_control_service import external_control_auth
    token = await asyncio.to_thread(external_control_auth.get_token)
    return ApiResult(data={"token": token})


@router.post("/token/rotate")
async def rotate_external_token(_: LocalUser = Depends(require_admin)):
    """轮换外部控制密钥（生成新值，旧密钥立即失效）"""
    from src.services_v2.external_control_service import external_control_auth
    token = await asyncio.to_thread(external_control_auth.rotate)
    return ApiResult(message="已轮换，请更新 MCP 配置", data={"token": token})


@router.get("/diag/system")
async def diag_system(_: bool = Depends(verify_external_token)):
    """系统资源：CPU%/内存/负载(load1/5/15)/线程数/打开FD数/事件循环延迟。

    注意：本函数的 docstring 会被 mcp_http.py 自动提取为 MCP 工具说明
    （给 AI 看），所以要写清"这个指标怎么读、什么情况算异常"。
    """
    from src.services_v2.system_stats_service import collect_system_stats
    data = await asyncio.to_thread(collect_system_stats)
    return ApiResult(data=data)


@router.get("/diag/queues")
async def diag_queues(_: bool = Depends(verify_external_token)):
    """削峰队列健康度：实体解析队列 + 访问日志缓冲的深度/丢弃/落库计数。

    depth 持续走高或 dropped 增长说明削峰失效，写入跟不上产生速度。
    """
    from src.services_v2.entity_ingest_queue import entity_ingest_queue
    from src.services_v2.access_log_buffer import access_log_buffer
    return ApiResult(data={
        "entity_ingest": entity_ingest_queue.stats(),
        "access_log": access_log_buffer.stats(),
    })


def _pool_stats() -> dict:
    """SQLAlchemy 连接池水位快照（同步，调用方放线程池）

    QueuePool 才有 size/checkedin/checkedout/overflow；StaticPool(SQLite) 没有，
    故逐个探测可调用性，缺失的键直接不返回。
    """
    pool = engine.pool
    info = {"dialect": engine.dialect.name}
    for attr in ("size", "checkedin", "checkedout", "overflow"):
        fn = getattr(pool, attr, None)
        if callable(fn):
            try:
                info[attr] = fn()
            except Exception:
                info[attr] = None
    return info


@router.get("/diag/db-pool")
async def diag_db_pool(_: bool = Depends(verify_external_token)):
    """SQLAlchemy 连接池水位(size/checkedin/checkedout/overflow)。

    checkedout 接近 size+overflow 说明连接池将耗尽，DB 成为瓶颈，
    此时请求会卡在等连接上（表现为接口整体变慢）。
    """
    data = await asyncio.to_thread(_pool_stats)
    return ApiResult(data=data)


@router.get("/diag/control")
async def diag_control(_: bool = Depends(verify_external_token)):
    """control_client 长连接健康度：连接状态/pending RPC 数/消息积压/审计缓冲水位。

    msg_backlog 持续增长说明消息处理跟不上接收；
    audit_dropped 增长说明审计日志缓冲溢出（落库太慢）。
    """
    from src.services_v2.control_client import control_client
    return ApiResult(data=control_client.stats())


@router.get("/diag/config")
async def diag_config(_: bool = Depends(verify_external_token)):
    """配置下发全链路诊断：本地端应下发的 → DO 实际存的 → Worker 实际用的，三方对比。

    排查「后台配了但 Worker 没生效」的首选工具。返回三段：
    - local: 本地端此刻按 DB 组装出的下发内容（应该是什么）
    - do_storage: DO storage 里 runtime_config 的实际内容（下发存成了什么）
    - worker_runtime: 各 Worker 实例内存里合并后的最终值（实际在用什么）
    - diff: 自动比对结果，直接指出每个 UA 的 userGroupId/signGroupId 在哪一环丢了

    密钥类字段（obfKey/secret）已脱敏为 前4***后4(len=N)。
    do_storage 为 null 说明长连接不通或 DO 无响应；
    worker_runtime 为空说明 Worker 尚未上报（metrics 每 60s 一次，需等一个周期）。
    """
    from src.services_v2.control_client import control_client
    from src.services_v2.runtime_config_service import runtime_config_service

    def _mask(s):
        v = str(s or "")
        return f"{v[:4]}***{v[-4:]}(len={len(v)})" if v else ""

    # 1. 本地端此刻应下发的内容（按 DB 现状组装）
    local_payload = await asyncio.to_thread(runtime_config_service.build_full_payload)
    local_ua = {
        k: {
            "userAgent": v.get("userAgent", ""),
            "enabled": v.get("enabled", False),
            "signGroupId": v.get("signGroupId"),
            "userGroupId": v.get("userGroupId"),
        }
        for k, v in (local_payload.get("ua_configs") or {}).items()
    }
    local = {
        "ua_configs": local_ua,
        "user_allow_pool": [
            {
                "groupId": g.get("groupId"),
                "userCount": len(g.get("users") or []),
                "usersSample": (g.get("users") or [])[:3],
                "brandMark": g.get("brandMark"),
                "obfKey": _mask(g.get("obfKey")) or None,
            }
            for g in (local_payload.get("user_allow_pool") or [])
        ],
        "sign_key_pool": [
            {"groupId": g.get("groupId"), "secret": _mask(g.get("secret")) or None}
            for g in (local_payload.get("sign_key_pool") or [])
        ],
    }

    # 2. DO storage 实际内容（经长连接 RPC 索取）
    do_storage = await control_client.dump_do_config()

    # 3. 各 Worker 实例内存里的最终值（metrics 上报时带回）
    worker_runtime = control_client.get_worker_config_state()

    # 4. 自动比对：逐 UA 检查 userGroupId/signGroupId 在哪一环丢失
    diff = []
    do_ua = (do_storage or {}).get("ua_configs") or {}
    # 取任一 Worker 实例的内存态做对比（多实例配置应一致）
    wk_state = next(iter(worker_runtime.values()), {}).get("state") or {}
    wk_ua = wk_state.get("uaConfigs") or {}
    for ua_key, lv in local_ua.items():
        for field in ("userGroupId", "signGroupId"):
            lval, dval = lv.get(field), (do_ua.get(ua_key) or {}).get(field)
            wval = (wk_ua.get(ua_key) or {}).get(field)
            if lval == dval == wval:
                continue
            # 定位丢失环节：本地有但 DO 没 → 下发未生效；DO 有但 Worker 没 → 实例未拉取
            if lval and not dval:
                stage = "下发未生效(本地有,DO无)：需在后台重新保存触发下发"
            elif dval and not wval:
                stage = "实例未拉取(DO有,Worker无)：等周期拉取或重新部署 Worker"
            elif not lval and (dval or wval):
                stage = "残留(本地已删,DO/Worker仍有)：DO 浅合并不删旧键"
            else:
                stage = "值不一致"
            diff.append({
                "ua_key": ua_key, "field": field,
                "local": lval, "do_storage": dval, "worker_runtime": wval,
                "stage": stage,
            })

    return ApiResult(data={
        "local": local,
        "do_storage": do_storage,
        "worker_runtime": worker_runtime,
        "diff": diff,
        "hint": ("diff 为空表示三方一致。do_storage 为 null 说明长连接不通；"
                 "worker_runtime 为空说明 Worker 尚未上报(metrics 周期 60s)"),
    })


@router.get("/diag/eventloop")
async def diag_eventloop(_: bool = Depends(verify_external_token)):
    """事件循环延迟(loop_lag_ms)与运行中任务数。

    lag 高（>100ms）说明存在同步阻塞，所有请求会整体变慢——
    通常是某处同步 DB 调用没放线程池。
    """
    from src.services_v2.system_stats_service import get_loop_lag_ms
    running = len([t for t in asyncio.all_tasks() if not t.done()])
    return ApiResult(data={
        "loop_lag_ms": get_loop_lag_ms(),
        "running_tasks": running,
    })


@router.get("/diag/slow-sql")
async def diag_slow_sql(top: int = 20, _: bool = Depends(verify_external_token)):
    """慢 SQL 排行：按累计耗时排序的 Top N 查询指纹 + 最近慢查询明细。

    定位"某个页面加载慢"的直接依据——看哪条 SQL 累计耗时最高、
    平均多少毫秒、执行了几次。每条含 fingerprint(归一化SQL) /
    count / total_ms / max_ms / avg_ms / sample。

    参数：
        top: 返回条数，默认 20
    """
    from src.services_v2 import slow_sql_service
    return ApiResult(data=slow_sql_service.get_stats(top=top))


@router.post("/diag/slow-sql/reset")
async def diag_slow_sql_reset(_: bool = Depends(verify_external_token)):
    """清空慢 SQL 统计，便于针对某次操作单独观测。

    推荐用法：先 reset，让用户操作目标页面，再调 diag_slow_sql，
    这样看到的就是本次操作实际产生的慢查询，不受历史数据干扰。
    """
    from src.services_v2 import slow_sql_service
    slow_sql_service.reset()
    return ApiResult(message="已清空慢 SQL 统计")


@router.get("/diag/snapshot")
async def diag_snapshot(_: bool = Depends(verify_external_token)):
    """一次性抓取全部诊断指标（系统资源/事件循环/队列/连接池/长连接/慢SQL Top5）。

    定位性能问题的首选：一次看全运行健康度，再按可疑项调用对应的细项接口。
    """
    from src.services_v2.system_stats_service import collect_system_stats, get_loop_lag_ms
    from src.services_v2.entity_ingest_queue import entity_ingest_queue
    from src.services_v2.access_log_buffer import access_log_buffer
    from src.services_v2.control_client import control_client
    from src.services_v2 import slow_sql_service

    system = await asyncio.to_thread(collect_system_stats)
    db_pool = await asyncio.to_thread(_pool_stats)
    return ApiResult(data={
        "system": system,
        "eventloop": {
            "loop_lag_ms": get_loop_lag_ms(),
            "running_tasks": len([t for t in asyncio.all_tasks() if not t.done()]),
        },
        "queues": {
            "entity_ingest": entity_ingest_queue.stats(),
            "access_log": access_log_buffer.stats(),
        },
        "db_pool": db_pool,
        "control": control_client.stats(),
        # 慢 SQL Top 5：快照里只带最关键的几条，明细看 /diag/slow-sql
        "slow_sql": slow_sql_service.get_stats(top=5),
    })


# ==================== 数据查询（只读） ====================

@router.get("/data/db-tables")
async def data_db_tables(_: bool = Depends(verify_external_token)):
    """各表行数 / 占用大小 / 占比 + 连接池状态，按占用大小倒序。

    排查方向：
    - row_count 异常膨胀的表通常是日志/缓存类表未清理，会拖慢该表的查询；
    - size_bytes 占比高的表优先考虑加保留策略（见 cleanup 策略页）。
    """
    from src.services_v2.db_stats_service import collect_sql_stats
    data = await asyncio.to_thread(collect_sql_stats)
    return ApiResult(data=data)


@router.get("/data/db-engine-perf")
async def data_db_engine_perf(_: bool = Depends(verify_external_token)):
    """数据库引擎性能指标（按方言自动分派 MySQL / PostgreSQL / SQLite）。

    MySQL 重点看：InnoDB 缓冲池命中率(<95% 说明内存不足)、连接使用率
    (>80% 有耗尽风险)、表锁等待(>0 说明有锁竞争)、慢查询计数。
    每项带 warn 标记，为 true 即超出健康阈值。
    """
    from src.services_v2.db_stats_service import collect_engine_perf
    data = await asyncio.to_thread(collect_engine_perf)
    return ApiResult(data=data)


@router.get("/data/redis-stats")
async def data_redis_stats(_: bool = Depends(verify_external_token)):
    """Redis 状态：命中率 / 内存 / 连接数 / QPS / 淘汰与过期 key 数。

    hit_rate 偏低说明缓存键设计或 TTL 有问题；
    evicted_keys 持续增长说明内存不足在淘汰数据（缓存会频繁回源）。
    enabled=false 表示未启用或连接失败，此时响应体走 SQL 冷备。
    """
    from src.services_v2.db_stats_service import collect_redis_stats
    data = await collect_redis_stats()
    return ApiResult(data=data)


@router.get("/data/db-query")
async def data_db_query(
    sql: str = Query(..., description="只读 SQL：SELECT/WITH/EXPLAIN/SHOW/DESC"),
    max_rows: int = 200,
    _: bool = Depends(verify_external_token),
):
    """执行只读 SQL 查询（表可查、密钥不可见）。

    用途：查表行数、跑 EXPLAIN 确认索引是否生效、核对具体数据。
    例：SELECT COUNT(*) FROM ip_rules
        EXPLAIN SELECT * FROM ip_rules WHERE enabled = true

    安全限制（违反即拒绝，不会执行）：
    - 仅允许 SELECT / WITH / EXPLAIN / SHOW / DESC 开头的单条语句
    - 禁止 INSERT/UPDATE/DELETE/DROP/ALTER 等写操作关键字与 SQL 注释
    - 在事务内执行且始终 rollback，无法产生任何持久化变更
    - 列名含 secret/token/password/app_secret 等的值一律返回 ***REDACTED***
      （被脱敏的列名会列在 masked_columns 里）
    - 结果最多 1000 行；超出 max_rows 时 truncated=true

    参数：
        sql      要执行的只读 SQL
        max_rows 返回行数上限，默认 200，硬上限 1000
    """
    from src.services_v2 import readonly_sql_service
    try:
        data = await asyncio.to_thread(readonly_sql_service.run_query, sql, max_rows)
    except ValueError as e:
        # 校验不通过：明确告知原因，便于调用方改写语句
        return ApiResult(success=False, message=f"SQL 被拒绝: {e}", data=None)
    except Exception as e:
        logger.warning(f"⚠️ 只读查询执行失败: {e}")
        return ApiResult(success=False, message=f"执行失败: {e}", data=None)
    return ApiResult(data=data)


# ==================== 日志查询（只读） ====================

@router.get("/logs/app")
async def logs_app(
    limit: int = 200,
    pattern: Optional[str] = None,
    level: Optional[str] = None,
    _: bool = Depends(verify_external_token),
):
    """本地端应用日志尾部（含异常堆栈），来自轮转文件 config/logs/app.log。

    这是查本地端自身报错的唯一途径（Worker 请求日志请用 /logs/worker）。
    available=false 说明日志未落盘（目录不可写），此时只能看容器 stdout。

    参数：
        limit   返回行数，默认 200，上限 2000
        pattern 正则过滤（忽略大小写）；非法正则退化为纯文本包含匹配
        level   仅看该级别：ERROR / WARNING / INFO / DEBUG
    """
    from src.services_v2 import log_file_service
    data = await asyncio.to_thread(
        log_file_service.read_logs, limit, pattern, level
    )
    return ApiResult(data=data)


@router.get("/logs/worker")
async def logs_worker(
    limit: int = 50,
    level: Optional[str] = None,
    keyword: Optional[str] = None,
    ip: Optional[str] = None,
    ua: Optional[str] = None,
    user_id: Optional[str] = None,
    _: bool = Depends(verify_external_token),
):
    """Worker 请求日志（轮转 JSONL 文件），按时间倒序。

    数据源已从 worker_request_logs 表迁移到轮转文件（worker.log），
    聚合统计走 worker_log_daily_stats 按日计数表。

    每条含 path / query / status / cache_source / duration_ms /
    请求体响应体等。排查方向：cache_source 看命中来源分布，
    duration_ms 找慢请求，status>=400 找失败请求。

    参数：
        limit   返回条数，默认 50，上限 200
        level   INFO / WARN / ERROR
        keyword 跨字段搜（path/query/message/body）
        ip      按客户端 IP 模糊匹配
        ua      按 X-UA 模糊匹配
        user_id 按客户端用户标识模糊匹配
    """
    from src.services_v2.worker_log_file_service import worker_log_file_service

    limit = max(1, min(int(limit or 50), 200))

    def _query():
        # 只查当前文件，page_size=limit（不分页，一次返回 limit 条）
        res = worker_log_file_service.search(
            file_name=None,  # 当前 worker.log
            level=level,
            keyword=keyword,
            ip=ip,
            ua=ua,
            user_id=user_id,
            status=None,
            page=1,
            page_size=limit,
        )
        items = res["items"]
        # 返回格式与旧接口保持一致（去掉 request_body/response_body 大字段）
        return [{
            "created_at": r.get("created_at"),
            "level": r.get("level"),
            "client_ip": r.get("client_ip"),
            "ua_type": r.get("ua_type"),
            "client_user_id": r.get("client_user_id"),
            "method": r.get("method"),
            "path": r.get("path"),
            "query": r.get("query"),  # 新增：GET 请求的搜索词在这里
            "status": r.get("status"),
            "cache_source": r.get("cache_source"),
            "upstream_status": r.get("upstream_status"),
            "duration_ms": r.get("duration_ms"),
            "response_bytes": r.get("response_bytes"),
            "message": r.get("message"),
        } for r in items]

    items = await asyncio.to_thread(_query)
    return ApiResult(data={"returned": len(items), "items": items})


@router.get("/logs/runtime")
async def logs_runtime(
    limit: int = 50,
    level: Optional[str] = None,
    category: Optional[str] = None,
    _: bool = Depends(verify_external_token),
):
    """本地端运行事件（runtime_events 表）：配置下发 / 封禁 / 异常等结构化事件。

    与 /logs/app 的区别：这里是业务语义事件（带 category/event/details），
    app 是原始日志文本。排查"配置有没有下发成功"优先看这里。

    参数：
        limit    返回条数，默认 50，上限 200
        level    INFO / WARN / ERROR
        category 事件分类
    """
    from src.services_v2.runtime_event_service import runtime_event_service
    limit = max(1, min(int(limit or 50), 200))
    # query 签名为 (level, category, event, limit)
    items = await asyncio.to_thread(
        runtime_event_service.query, level, category, None, limit
    )
    return ApiResult(data={"returned": len(items), "items": items})


@router.get("/logs/cache-access")
async def logs_cache_access(
    limit: int = 50,
    access_type: Optional[str] = None,
    cache_key: Optional[str] = None,
    _: bool = Depends(verify_external_token),
):
    """缓存访问日志（api_cache_access_logs 表）：命中 / 未命中 / 429 兜底记录。

    所有访问类型全量保存。access_type 取值包括 hit / miss / stale_hit /
    expired / upsert / assembled / 429；可按类型筛选排查缓存行为。

    参数：
        limit       返回条数，默认 50，上限 200
        access_type 按类型过滤
        cache_key   按缓存键模糊匹配（键里的中文是 URL 编码形式）
    """
    from src.models_v2 import ApiCacheAccessLog
    from src.database import get_db_sync

    limit = max(1, min(int(limit or 50), 200))

    def _query():
        db = get_db_sync()
        try:
            q = db.query(ApiCacheAccessLog)
            if access_type:
                q = q.filter(ApiCacheAccessLog.access_type == access_type)
            if cache_key:
                q = q.filter(ApiCacheAccessLog.cache_key.like(f"%{cache_key}%"))
            rows = q.order_by(ApiCacheAccessLog.created_at.desc()).limit(limit).all()
            return [{
                "id": r.id, "created_at": r.created_at.isoformat() if r.created_at else None,
                "cache_key": r.cache_key, "api_path": r.api_path,
                "access_type": r.access_type, "upstream_status": r.upstream_status,
                "served_status": r.served_status, "client_ip": r.client_ip,
            } for r in rows]
        finally:
            db.close()

    items = await asyncio.to_thread(_query)
    return ApiResult(data={"returned": len(items), "items": items})


# ==================== 业务数据核查（只读） ====================

@router.get("/biz/cache-search")
async def biz_cache_search(
    keyword: Optional[str] = None,
    api_path: Optional[str] = None,
    is_empty: Optional[bool] = None,
    limit: int = 20,
    _: bool = Depends(verify_external_token),
):
    """查响应缓存条目：命中次数 / TTL / 体积 / 是否空结果负缓存。

    排查方向：hit_count 为 0 且量大说明缓存键设计有问题（key 每次都变）；
    expire_at 已过期却还在说明清理没跑；is_empty=true 是空结果负缓存。
    注意 cache_key 里的中文是 URL 编码形式，搜索时用编码后的串或用 api_path。

    参数：
        keyword  按 cache_key 模糊匹配
        api_path 按接口路径模糊匹配
        is_empty true=只看空结果负缓存
        limit    返回条数，默认 20，上限 100
    """
    from src.models_v2 import ApiResponseCache
    from src.database import get_db_sync

    limit = max(1, min(int(limit or 20), 100))

    def _query():
        db = get_db_sync()
        try:
            q = db.query(ApiResponseCache)
            if keyword:
                q = q.filter(ApiResponseCache.cache_key.like(f"%{keyword}%"))
            if api_path:
                q = q.filter(ApiResponseCache.api_path.like(f"%{api_path}%"))
            if is_empty is not None:
                q = q.filter(ApiResponseCache.is_empty == is_empty)
            rows = q.order_by(ApiResponseCache.fetched_at.desc()).limit(limit).all()
            return [{
                "id": r.id, "cache_key": r.cache_key, "api_path": r.api_path,
                "method": r.method, "status_code": r.status_code,
                "body_size": r.body_size, "storage_mode": r.storage_mode,
                "hit_count": r.hit_count, "stale_hit_count": r.stale_hit_count,
                "upstream_429_count": r.upstream_429_count,
                "is_empty": r.is_empty, "refresh_pending": r.refresh_pending,
                "fetched_at": r.fetched_at.isoformat() if r.fetched_at else None,
                "expire_at": r.expire_at.isoformat() if r.expire_at else None,
            } for r in rows]
        finally:
            db.close()

    items = await asyncio.to_thread(_query)
    return ApiResult(data={"returned": len(items), "items": items})


@router.get("/biz/ip-rules")
async def biz_ip_rules(
    rule_type: Optional[str] = None,
    only_expired: bool = False,
    limit: int = 100,
    _: bool = Depends(verify_external_token),
):
    """查 IP 黑白名单规则，含自动封禁记录与过期统计。

    重点：summary.expired_count 是已过期但仍留在表里的规则数。
    该表被配置下发链路全表扫描（build_full_payload），行数膨胀会直接
    拖慢每次下发，过期记录多说明缺少清理。

    参数：
        rule_type    black / white
        only_expired true=只看已过期的规则
        limit        返回条数，默认 100，上限 500
    """
    from src.models_v2 import IpRule
    from src.models_v2.base import now as _now
    from src.database import get_db_sync
    from src.services_v2.abuse_service import ABUSE_CREATED_BY
    from sqlalchemy import func

    limit = max(1, min(int(limit or 100), 500))

    def _query():
        db = get_db_sync()
        try:
            current = _now()
            total = db.query(func.count(IpRule.id)).scalar() or 0
            expired_count = db.query(func.count(IpRule.id)).filter(
                IpRule.expires_at.isnot(None), IpRule.expires_at < current
            ).scalar() or 0
            auto_count = db.query(func.count(IpRule.id)).filter(
                IpRule.created_by == ABUSE_CREATED_BY
            ).scalar() or 0

            q = db.query(IpRule)
            if rule_type:
                q = q.filter(IpRule.rule_type == rule_type)
            if only_expired:
                q = q.filter(IpRule.expires_at.isnot(None),
                             IpRule.expires_at < current)
            rows = q.order_by(IpRule.id.desc()).limit(limit).all()
            return {
                "summary": {
                    "total": int(total),
                    "expired_count": int(expired_count),
                    "auto_banned_count": int(auto_count),
                },
                "returned": len(rows),
                "items": [{
                    "id": r.id, "ip_or_cidr": r.ip_or_cidr,
                    "rule_type": r.rule_type, "reason": r.reason,
                    "enabled": r.enabled, "created_by": r.created_by,
                    "expires_at": r.expires_at.isoformat() if r.expires_at else None,
                    "expired": bool(r.expires_at and r.expires_at < current),
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                } for r in rows],
            }
        finally:
            db.close()

    data = await asyncio.to_thread(_query)
    return ApiResult(data=data)


@router.get("/biz/config-payload")
async def biz_config_payload(_: bool = Depends(verify_external_token)):
    """当前实际下发给 Worker 的完整运行配置（密钥字段已脱敏）。

    排查"后台改了配置但 Worker 行为没变"时看这里：确认 ip_blacklist /
    ua_configs / signGroupId 等是否真的进了下发内容。
    注意：本接口只是重新组装一份 payload 供查看，**不会触发下发**。
    密钥类字段（secret/token 等）值为 ***REDACTED***。
    """
    from src.services_v2.runtime_config_service import runtime_config_service
    from src.services_v2 import readonly_sql_service

    def _build():
        payload = runtime_config_service.build_full_payload()
        # 下发内容含签名密钥与上游 appSecret，必须脱敏后才能出网
        return readonly_sql_service.mask_mapping(payload)

    data = await asyncio.to_thread(_build)
    return ApiResult(data=data)


@router.get("/biz/dashboard-summary")
async def biz_dashboard_summary(_: bool = Depends(verify_external_token)):
    """业务总览：缓存/实体/集数/日志总量、命中率、今日请求量等汇总指标。

    先看这里建立全局印象，再用细项接口深入。
    """
    from src.api.v2.endpoints.dashboard import _build_summary
    data = await asyncio.to_thread(_build_summary)
    return ApiResult(data=data)


@router.get("/biz/cleanup-policies")
async def biz_cleanup_policies(_: bool = Depends(verify_external_token)):
    """数据保留清理策略：各表是否启用、保留天数、上次清理时间与删除量。

    表行数持续膨胀时看这里：enabled=false 或 retention_days 过大即为原因。
    只读查看，不执行清理。
    """
    from src.services_v2.cleanup_service import cleanup_service
    from src.models_v2 import CleanupPolicy
    from src.database import get_db_sync
    from src.api.v2.endpoints.cleanup import _policy_dict, TABLE_REGISTRY

    def _fetch():
        # 复用 cleanup 端点的 _policy_dict / TABLE_REGISTRY，保持结构与后台一致
        cleanup_service.ensure_default_policies()
        db = get_db_sync()
        try:
            items = []
            for p in db.query(CleanupPolicy).all():
                d = _policy_dict(p)
                reg = TABLE_REGISTRY.get(p.table_key)
                if reg:
                    try:
                        d["row_count"] = db.query(reg[0]).count()
                    except Exception:
                        d["row_count"] = None
                items.append(d)
            return {"policies": items}
        finally:
            db.close()

    data = await asyncio.to_thread(_fetch)
    return ApiResult(data=data)
