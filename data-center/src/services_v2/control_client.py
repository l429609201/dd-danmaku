"""
本地端 WebSocket 控制客户端

职责：
- 本地端主动连接 Worker ControlHub（/control/ws），避免本地端公网暴露；
- 自动重连 + 心跳；
- 处理 Worker 下发的 RPC：cache.get / cache.upsert；
- 主动向 Worker 发起 RPC：r2.comment.get / r2.comment.list（pending future 等待结果）；
- 连接状态写入 control_nodes，消息审计写入 control_messages。

设计意图：长连接本身不能让本地端直接读 R2 binding，
但可以让本地端通过该长连接发 r2.comment.get，由 Worker 代读 R2 后回传。
"""
import asyncio
import json
import logging
import uuid
from typing import Any, Dict, Optional

from src.config import settings
from src.database import get_db_sync
from src.models_v2 import ControlNode, ControlMessage
from src.models_v2.base import now
from src.services_v2.cache_service import cache_service
from src.services_v2.entity_ingest_queue import entity_ingest_queue
from src.services_v2.ip_stats_service import ip_stats_service
from src.services_v2.worker_log_service import worker_log_service
from src.services_v2.runtime_event_service import runtime_event_service
from src.services_v2.abuse_service import abuse_service
from src.services_v2.metrics_service import metrics_service
from src.services_v2.comment_store_service import comment_store_service
from src.services_v2.key_pool_service import key_pool_service

logger = logging.getLogger(__name__)

try:
    from websockets.asyncio.client import connect as ws_connect
    from websockets.exceptions import ConnectionClosed
except Exception:  # pragma: no cover - 未安装 websockets 时不阻塞启动
    ws_connect = None
    ConnectionClosed = Exception


class ControlClient:
    """本地端长连接控制客户端"""

    def __init__(self):
        self._ws = None
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._connected = False
        # 等待 Worker 回包的本地发起 RPC：message_id -> Future
        self._pending: Dict[str, asyncio.Future] = {}
        self._node_id = settings.CONTROL_NODE_ID
        self._reconnect_count = 0
        # 滥用封禁回灌的后台任务（避免在接收循环里同步等回包导致自死锁）
        self._resync_task: Optional[asyncio.Task] = None
        # 多 Worker 隔离实例会并发上报封禁；用 dirty + 冷却合并全量配置下发，
        # 避免每条 abuse.report 都写一次 DO storage 形成 config.apply 风暴。
        self._resync_dirty = False
        self._last_resync_at = 0.0
        self._RESYNC_DEBOUNCE = 5.0
        self._RESYNC_COOLDOWN = 30.0
        # 可观测：累计收到消息数 / 累计处理消息数（供外部诊断 API）
        self._msg_received = 0
        self._msg_handled = 0
        # 消息并发处理上限（防突发击穿事件循环 / DB 连接池）；
        # 延迟到 start() 内创建，确保绑定运行中的事件循环
        self._dispatch_sem: Optional[asyncio.Semaphore] = None
        # 审计日志内存缓冲：_audit 原为同步 DB 写入且每条消息都调一次
        # （cache.get 每请求一次），是事件循环阻塞的主要来源。
        # 改为攒批后台落库，主流程只做 list.append（纯内存，零阻塞）。
        self._audit_buf: list = []
        self._audit_task: Optional[asyncio.Task] = None
        self._audit_dropped = 0
        self._audit_sampled_out = 0
        # 这些成功消息已有专门数据源，审计表仅保留 1% 用于链路抽查；
        # 失败/超时及其他业务消息仍全量保存，避免削弱故障诊断能力。
        self._AUDIT_SAMPLE_RATE = 100
        self._AUDIT_SAMPLED_SUCCESS_TYPES = {
            "cache.get", "cache.upsert", "log.report",
            "metrics.report", "stats.report", "keypool.report",
        }
        self._audit_sample_counters: Dict[str, int] = {}
        self._AUDIT_BUF_MAX = 5000       # 缓冲上限，超出丢弃保护内存
        self._AUDIT_FLUSH_BATCH = 200    # 单批落库条数
        self._AUDIT_FLUSH_INTERVAL = 2.0  # 落库间隔（秒）
        # Worker 实例上报的内存配置状态（诊断用瞬时态，不落库）：worker_id -> {reported_at, state}
        self._worker_config_state: Dict[str, Any] = {}

    def stats(self) -> dict:
        """运行时可观测指标（供外部诊断 API）"""
        return {
            "connected": self._connected,
            "node_id": self._node_id,
            "reconnect_count": self._reconnect_count,
            "pending_rpc": len(self._pending),
            "msg_received": self._msg_received,
            "msg_handled": self._msg_handled,
            "msg_backlog": max(0, self._msg_received - self._msg_handled),
            # 审计缓冲水位：depth 持续走高或 dropped 增长说明落库跟不上
            "audit_buf_depth": len(self._audit_buf),
            "audit_dropped": self._audit_dropped,
            "audit_sampled_out": self._audit_sampled_out,
            "config_resync_pending": bool(
                self._resync_task and not self._resync_task.done()),
            "config_resync_dirty": self._resync_dirty,
        }

    @property
    def connected(self) -> bool:
        return self._connected

    # ---------- 生命周期 ----------
    async def start(self):
        """启动后台连接任务（不阻塞主流程）"""
        if not settings.CONTROL_WORKER_WS_URL:
            logger.info("ℹ️ 未配置 CONTROL_WORKER_WS_URL，跳过长连接客户端")
            return
        if ws_connect is None:
            logger.warning("⚠️ 未安装 websockets 包，长连接客户端不可用")
            return
        self._running = True
        self._dispatch_sem = asyncio.Semaphore(100)
        self._task = asyncio.create_task(self._run_loop())
        # 启动审计日志批量落库消费者
        self._audit_task = asyncio.create_task(self._audit_flush_loop())
        logger.info("✅ 本地端 WebSocket 控制客户端已启动")

    async def stop(self):
        """停止客户端"""
        self._running = False
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        # 防抖任务也必须随服务停机取消，避免关闭阶段继续发 config.apply。
        if self._resync_task and not self._resync_task.done():
            self._resync_task.cancel()
            try:
                await self._resync_task
            except asyncio.CancelledError:
                pass
        # 停审计消费者，并把缓冲里剩余的审计记录落库，避免丢数据
        if self._audit_task and not self._audit_task.done():
            self._audit_task.cancel()
            try:
                await self._audit_task
            except asyncio.CancelledError:
                pass
        if self._audit_buf:
            rows, self._audit_buf = self._audit_buf, []
            try:
                await asyncio.to_thread(self._audit_flush_db, rows)
            except Exception:
                pass
        self._connected = False

    # ---------- 主循环 ----------
    async def _run_loop(self):
        """自动重连主循环"""
        url = settings.CONTROL_WORKER_WS_URL
        headers = {}
        if settings.CONTROL_TOKEN:
            headers["X-Control-Token"] = settings.CONTROL_TOKEN
        # node_id 通过 query 传给 Worker
        sep = "&" if "?" in url else "?"
        full_url = f"{url}{sep}node_id={self._node_id}"

        while self._running:
            try:
                async with ws_connect(
                    full_url, additional_headers=headers,
                    # ping_interval: 每 20 秒发一次 ping
                    # ping_timeout: 等待 pong 的最长时间，改为 60 秒以容忍
                    #   config.apply 的 DO storage 慢速写入（10 秒超时 + 排队）
                    ping_interval=20, ping_timeout=60, open_timeout=10,
                    # 配置与批量日志可能超过默认 1 MiB；保留 8 MiB 明确上限，
                    # 避免已在线上发生的 1009 message too big 反复断连。
                    max_size=8 * 1024 * 1024,
                ) as ws:
                    self._ws = ws
                    self._connected = True
                    self._update_node(connected=True)
                    runtime_event_service.log("INFO", "control", "ws_connected",
                                              f"已连接 Worker ControlHub: {url}")
                    logger.info(f"✅ 已连接 Worker ControlHub: {url}")
                    await self._recv_loop(ws)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"⚠️ 长连接断开，准备重连: {e}")
            finally:
                self._connected = False
                self._ws = None
                self._update_node(connected=False, last_error="connection closed")

            if not self._running:
                break
            self._reconnect_count += 1
            # 退避重连，最多 30 秒
            delay = min(30, 2 ** min(self._reconnect_count, 5))
            await asyncio.sleep(delay)

    async def _recv_loop(self, ws):
        """接收并分发消息。

        并发化（K）：除 .result 回包需即时设置 future 外，其余消息处理
        用 create_task 并发执行 + 信号量限流，避免单条慢处理（如 DB 查询）
        阻塞整条消息流，提升高并发吞吐。
        """
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except Exception:
                logger.warning("⚠️ 收到非法 JSON 消息，忽略")
                continue
            self._msg_received += 1
            msg_type = msg.get("type") or ""
            # RPC 回包必须即时处理（设置 pending future），不能并发以免乱序
            if msg_type.endswith(".result"):
                await self._dispatch(msg)
                self._msg_handled += 1
            else:
                # 其余消息并发处理，不阻塞后续收包
                asyncio.create_task(self._dispatch_guarded(msg))

    async def _dispatch_guarded(self, msg: Dict[str, Any]):
        """带并发上限的分发包装（信号量限流 + 异常隔离 + 处理计数）"""
        async with self._dispatch_sem:
            try:
                await self._dispatch(msg)
            except Exception as e:
                logger.warning(f"⚠️ 消息处理异常（隔离）: {e}")
            finally:
                self._msg_handled += 1

    # ---------- 消息分发 ----------
    async def _dispatch(self, msg: Dict[str, Any]):
        msg_type = msg.get("type")
        msg_id = msg.get("id")
        payload = msg.get("payload") or {}

        # 本地发起 RPC 的回包
        if msg_type and msg_type.endswith(".result"):
            fut = self._pending.pop(msg_id, None)
            if fut and not fut.done():
                fut.set_result(payload)
            return

        if msg_type == "cache.get":
            await self._handle_cache_get(msg_id, payload)
        elif msg_type == "cache.upsert":
            await self._handle_cache_upsert(msg_id, payload)
        elif msg_type == "alias.query":
            await self._handle_alias_query(msg_id, payload)
        elif msg_type == "stats.report":
            await self._handle_stats_report(msg_id, payload)
        elif msg_type == "log.report":
            await self._handle_log_report(msg_id, payload)
        elif msg_type == "abuse.report":
            await self._handle_abuse_report(msg_id, payload)
        elif msg_type == "metrics.report":
            await self._handle_metrics_report(msg_id, payload)
        elif msg_type == "keypool.report":
            await self._handle_keypool_report(msg_id, payload)
        elif msg_type == "comment.archive":
            await self._handle_comment_archive(msg_id, payload)
        elif msg_type == "comment.get":
            await self._handle_comment_get(msg_id, payload)
        elif msg_type == "ping":
            await self._send({"id": msg_id, "type": "pong", "timestamp": _ts()})
        else:
            logger.debug(f"ℹ️ 未处理的消息类型: {msg_type}")

    async def _handle_cache_get(self, msg_id, payload):
        """Worker 缓存查询：429 兜底或内存未命中预查。
        预查（prefetch=true）不写 miss 日志，避免 access_logs 暴涨"""
        cache_key = payload.get("cache_key", "")
        worker_request_id = payload.get("worker_request_id")
        client_ip = payload.get("client_ip")
        # 强制回源仍需保留 approved 别名改写，但绝不能读取缓存体或触发实体拼装。
        if payload.get("alias_only"):
            extra = await self._resolve_alias(cache_key)
            await self._send({
                "id": msg_id, "type": "cache.get.result",
                "timestamp": _ts(),
                "payload": extra or {"hit": False},
            })
            self._audit("worker_to_local", "cache.get", "success",
                        request_cache_key=cache_key)
            return
        # prefetch 标记：内存未命中的主动预查，命中才有日志价值
        log_miss = not bool(payload.get("prefetch"))
        # allow_stale：Worker 回源配额耗尽时的降级查询，过期数据也返回
        allow_stale = bool(payload.get("allow_stale"))
        result = await cache_service.get(
            cache_key, worker_request_id=worker_request_id,
            client_ip=client_ip, log_miss=log_miss,
            allow_stale=allow_stale,
        )
        hit = bool(result and result.get("hit"))
        # 空结果负缓存：命中了也只是"确认搜不到"，不是有用数据。
        # 此时若已有 approved 别名，换规范词回源远胜于把空结果吐回去。
        # 不加这个判断，热词（负缓存最新鲜、最不易过期）的别名会长期不生效——
        # 而热词恰恰是最需要修的那批。
        empty_hit = bool(result and result.get("is_empty"))
        # 未命中或负缓存命中时做别名解析：不新增 RPC 往返，Worker 拿到
        # canonical 就用规范词重组 URL 回源。
        extra = None
        if not hit or empty_hit:
            extra = await self._resolve_alias(cache_key)
        # 负缓存命中但解析出了别名 → 按未命中处理，让 Worker 拿规范词回源
        if empty_hit and extra:
            hit = False
        await self._send({
            "id": msg_id, "type": "cache.get.result",
            "timestamp": _ts(),
            "payload": result if hit else (extra or {"hit": False}),
        })
        self._audit("worker_to_local", "cache.get",
                    "success" if hit else "success",
                    request_cache_key=cache_key)

    @staticmethod
    async def _resolve_alias(cache_key: str):
        """查 approved 别名，返回 {hit:False, alias_hit:True, canonical:...}。

        同步 DB 查询放线程池，避免阻塞事件循环（cache.get 是每请求一次的热路径）。
        任何异常都降级为 None——别名是增值功能，不能影响缓存查询主流程。
        """
        import asyncio
        try:
            from src.database import get_db_sync
            from src.services_v2.media_meta_service import media_meta_service

            def _q():
                db = get_db_sync()
                try:
                    return media_meta_service.resolve_search_term(db, cache_key)
                finally:
                    db.close()
            r = await asyncio.to_thread(_q)
            if not r:
                return None

            # 裸系列词可能被某一季的 approved 别名抢先改写（如 OVERLORD → OVERLORD II）。
            # 若本地已能按原词聚合出多个季度，应保留原词进入正式缓存查询，
            # 让 cache_service 的多季度覆盖逻辑返回完整系列，而不是截断为单季。
            term = r.get("term")
            if term:
                from src.services_v2.alias_external_service import alias_external_service
                series = await asyncio.to_thread(
                    alias_external_service.search_by_keyword, term)
                animes = series.get("animes") if isinstance(series, dict) else None
                if isinstance(animes, list) and len(animes) > 1:
                    logger.info(
                        f"🧩 裸系列词保留原词，跳过单季别名改写: "
                        f"{term} → {len(animes)} 季")
                    return None

            # hit 仍为 False：本地没有可用响应体，只是给 Worker 换个词去回源
            return {"hit": False, **r}
        except Exception as ex:
            logger.debug(f"ℹ️ 别名解析跳过: {ex}")
            return None

    async def _handle_cache_upsert(self, msg_id, payload):
        """Worker 200 响应：写入本地缓存 + 解析实体/集数链接"""
        ok = await cache_service.upsert(payload)
        # 实体/集数解析投递到异步批量队列（非阻塞），由后台消费者攒批落库，
        # 削平写入峰值、减少 commit 次数；不再每条即时写库。
        try:
            api_path = payload.get("api_path", "")
            cache_key = payload.get("cache_key", "")
            body = payload.get("body") or ""
            entity_ingest_queue.submit(api_path, cache_key, body)
        except Exception as e:
            logger.warning(f"⚠️ 实体/集数解析投递失败: {e}")
        await self._send({
            "id": msg_id, "type": "cache.upsert.result",
            "timestamp": _ts(),
            "payload": {"success": ok},
        })
        self._audit("worker_to_local", "cache.upsert",
                    "success" if ok else "failed",
                    request_cache_key=payload.get("cache_key"))

    async def _handle_alias_query(self, msg_id, payload):
        """Worker 429 限流时的别名兜底查询：用搜索词在本地别名表查已缓存集数

        Worker 调用时机：当弹幕 API 返回 429 且搜索接口（/search/episodes 或 /search/anime）时，
        Worker 会用搜索词调本接口，尝试从本地别名表查询已缓存的集数列表作为兜底。

        返回格式与弹幕 API 一致（{ animes: [...] }），方便 Worker 直接替换 429 响应。
        """
        from src.services_v2.alias_external_service import alias_external_service

        keyword = payload.get("keyword", "")
        success = False
        data = []

        if keyword:
            try:
                # 调用别名服务查询：返回 { animes: [{ animeId, animeTitle, type, episodes: [...] }] }
                result = await asyncio.to_thread(
                    alias_external_service.search_by_keyword, keyword
                )
                if result and result.get("animes"):
                    success = True
                    data = result["animes"]
                    logger.info(f"🔍 别名兜底查询命中: {keyword} → {len(data)} 个作品")
                else:
                    logger.info(f"🔍 别名兜底查询无匹配: {keyword}")
            except Exception as e:
                logger.warning(f"⚠️ 别名兜底查询失败: {keyword}, {e}")

        await self._send({
            "id": msg_id, "type": "alias.query.result",
            "timestamp": _ts(),
            "payload": {"success": success, "data": data},
        })
        self._audit("worker_to_local", "alias.query",
                    "success" if success else "no_match",
                    request_cache_key=keyword)

    async def _handle_stats_report(self, msg_id, payload):
        """Worker 主动上报 IP/限流统计：落库 current + snapshot

        落库是同步 DB 操作（最多 200 个 IP 的 upsert），必须放线程池，
        否则会长时间霸占事件循环（实测导致 loop_lag 达数百毫秒）。
        """
        ip_stats = payload.get("ip_stats") or []
        worker_id = payload.get("worker_id", "worker-1")
        saved = await asyncio.to_thread(
            ip_stats_service.ingest_report, worker_id, ip_stats
        )
        await self._send({
            "id": msg_id, "type": "stats.report.result",
            "timestamp": _ts(), "payload": {"success": True, "saved": saved},
        })
        self._audit("worker_to_local", "stats.report", "success")

    async def _handle_log_report(self, msg_id, payload):
        """Worker 主动上报日志：写入轮转 JSONL 文件、累计按日统计并 SSE 广播。

        文件写入是同步 I/O，放线程池避免阻塞事件循环。
        """
        logs = payload.get("logs") or []
        worker_id = payload.get("worker_id", "worker-1")
        saved = await asyncio.to_thread(
            worker_log_service.ingest_report, worker_id, logs
        )
        await self._send({
            "id": msg_id, "type": "log.report.result",
            "timestamp": _ts(), "payload": {"success": True, "saved": saved},
        })
        self._audit("worker_to_local", "log.report", "success")

    async def _handle_abuse_report(self, msg_id, payload):
        """Worker 上报"封禁中"IP：去重合并落库临时黑名单，再回灌全量配置"""
        banned = payload.get("banned") or []
        worker_id = payload.get("worker_id", "worker-1")
        changed = abuse_service.ingest_report(worker_id, banned)
        # 先回包，避免阻塞接收循环（回包与下方 config.apply 回包共用同一接收循环，
        # 若在此处同步 await push_to_worker 等回包会自死锁）
        await self._send({
            "id": msg_id, "type": "abuse.report.result",
            "timestamp": _ts(), "payload": {"success": True, "changed": changed},
        })
        self._audit("worker_to_local", "abuse.report", "success")
        # 有变更则把合并后的黑名单经长连接回灌各实例（跨实例收敛）——后台异步执行
        if changed > 0:
            self._schedule_config_resync()

    def _schedule_config_resync(self):
        """防抖并合并配置回灌，避免多实例 abuse.report 触发下发风暴。"""
        self._resync_dirty = True
        if self._resync_task and not self._resync_task.done():
            return

        async def _run():
            try:
                loop = asyncio.get_running_loop()
                while self._running and self._resync_dirty:
                    # 首批等待 5 秒聚合；后续变化至少间隔 30 秒再全量下发。
                    since_last = loop.time() - self._last_resync_at
                    delay = max(
                        self._RESYNC_DEBOUNCE,
                        self._RESYNC_COOLDOWN - since_last,
                    )
                    await asyncio.sleep(delay)
                    # 吸收等待期间的全部变化；下发过程中若又变化会重新置 dirty，
                    # 下一轮在冷却结束后补发一次，保证最终一致而不丢更新。
                    self._resync_dirty = False
                    from src.services_v2.runtime_config_service import runtime_config_service
                    success = await runtime_config_service.push_to_worker()
                    self._last_resync_at = loop.time()
                    # 超时或失败时保留 dirty，冷却后自动重试，避免配置永久停在旧版本。
                    if not success:
                        self._resync_dirty = True
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self._resync_dirty = True
                logger.warning(f"⚠️ 滥用封禁回灌下发失败: {e}")

        task = asyncio.create_task(_run())
        self._resync_task = task

        def _restart_if_dirty(done_task):
            # 收尾窗口内若又收到变化，旧任务已 done 后立即重新调度，避免丢更新。
            if self._resync_task is done_task:
                self._resync_task = None
            if self._running and self._resync_dirty:
                self._schedule_config_resync()

        task.add_done_callback(_restart_if_dirty)

    async def _handle_metrics_report(self, msg_id, payload):
        """Worker 上报运行指标快照：落库 worker_metrics_snapshot

        同步 DB 写入放线程池，避免阻塞事件循环。
        """
        metrics = payload.get("metrics") or {}
        worker_id = payload.get("worker_id", "worker-1")
        # 顺带缓存 Worker 实例内存里的配置状态（诊断用，密钥已在 Worker 侧脱敏）。
        # 只留最近一次，不落库——它是瞬时态，用于排查「后台配了但没生效」。
        cfg_state = payload.get("config_state")
        if cfg_state:
            self._worker_config_state[worker_id] = {
                "reported_at": _ts(),
                "state": cfg_state,
            }
        ok = await asyncio.to_thread(
            metrics_service.ingest_report,
            worker_id, metrics,
            payload.get("total_requests_lifetime", 0),
            payload.get("api_cache_size", 0),
            payload.get("tool_calls") or {},
            payload.get("memory_watermark") or {},
        )
        await self._send({
            "id": msg_id, "type": "metrics.report.result",
            "timestamp": _ts(), "payload": {"success": ok},
        })
        self._audit("worker_to_local", "metrics.report", "success" if ok else "failed")

    # ---------- 配置诊断 ----------
    def get_worker_config_state(self) -> Dict[str, Any]:
        """取各 Worker 实例上报的内存配置状态（最近一次 metrics 上报时带回）"""
        return dict(self._worker_config_state)

    async def dump_do_config(self, timeout: float = 5.0) -> Optional[Dict[str, Any]]:
        """
        主动向 DO 索取 runtime_config 的实际存储内容（密钥已脱敏）。

        与 get_worker_config_state 的区别：
        - 本方法 = DO storage 里「下发存成了什么」
        - get_worker_config_state = Worker 实例「实际在用什么」（env 基线合并后）
        两者对比可定位问题出在下发环节还是合并环节。
        """
        return await self.request("config.dump", {}, timeout=timeout)

    async def _handle_keypool_report(self, msg_id, payload):
        """Worker 上报密钥限流状态快照：按 worker_id upsert worker_key_state"""
        ok = await asyncio.to_thread(key_pool_service.ingest_key_state, payload)
        await self._send({
            "id": msg_id, "type": "keypool.report.result",
            "timestamp": _ts(), "payload": {"success": ok},
        })
        self._audit("worker_to_local", "keypool.report", "success" if ok else "failed")

    async def _handle_comment_archive(self, msg_id, payload):
        """Worker 弹幕归档：以条数为准存到本地端兜底持久化"""
        episode_id = payload.get("episode_id", "")
        body = payload.get("body", "")
        source = payload.get("source", "r2_archive")
        result = comment_store_service.archive(episode_id, body, source=source)
        await self._send({
            "id": msg_id, "type": "comment.archive.result",
            "timestamp": _ts(), "payload": result,
        })
        self._audit("worker_to_local", "comment.archive",
                    "success" if result.get("saved") else "skipped")

    async def _handle_comment_get(self, msg_id, payload):
        """Worker 弹幕兜底读取：429/R2 无对象时按 episode_id 取本地端"""
        episode_id = payload.get("episode_id", "")
        result = comment_store_service.get(episode_id)
        hit = bool(result and result.get("hit"))
        await self._send({
            "id": msg_id, "type": "comment.get.result",
            "timestamp": _ts(), "payload": result if hit else {"hit": False},
        })
        self._audit("worker_to_local", "comment.get",
                    "success" if hit else "miss")

    # ---------- 本地发起 RPC ----------
    async def request(self, msg_type: str, payload: Dict[str, Any],
                      timeout: float = 3.0) -> Optional[Dict[str, Any]]:
        """本地端主动发起 RPC，等待 Worker 回包"""
        if not self._connected or self._ws is None:
            return None
        msg_id = str(uuid.uuid4())
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[msg_id] = fut
        await self._send({
            "id": msg_id, "type": msg_type,
            "timestamp": _ts(), "payload": payload,
        })
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            self._pending.pop(msg_id, None)
            logger.warning(f"⚠️ RPC 超时: {msg_type}")
            return None

    async def r2_comment_get(self, episode_id: str) -> Optional[Dict[str, Any]]:
        """通过 Worker 代读 R2 comment 缓存"""
        return await self.request("r2.comment.get", {
            "episode_id": str(episode_id),
            "r2_key": f"comment/{episode_id}",
        })

    # ---------- 工具 ----------
    async def _send(self, msg: Dict[str, Any]):
        if self._ws is None:
            return
        try:
            await self._ws.send(json.dumps(msg, ensure_ascii=False))
        except Exception as e:
            logger.warning(f"⚠️ 发送消息失败: {e}")

    def _update_node(self, connected: bool, last_error: Optional[str] = None):
        """更新 control_nodes 连接状态"""
        try:
            db = get_db_sync()
            try:
                node = db.query(ControlNode).filter(
                    ControlNode.node_id == self._node_id
                ).first()
                if not node:
                    node = ControlNode(
                        node_id=self._node_id,
                        worker_id="worker-1",
                        worker_url=settings.CONTROL_WORKER_WS_URL or "",
                    )
                    db.add(node)
                node.connected = connected
                node.reconnect_count = self._reconnect_count
                node.last_seen_at = now()
                if connected:
                    node.last_connected_at = now()
                if last_error:
                    node.last_error = last_error
                db.commit()
            finally:
                db.close()
        except Exception as e:
            logger.debug(f"ℹ️ 更新节点状态失败: {e}")

    def _audit(self, direction: str, message_type: str, status: str,
               request_cache_key: Optional[str] = None):
        """写消息审计：高频常规成功消息采样，其余全量进入内存缓冲。

        cache/log/metrics/stats/keypool 已有专门数据源，重复成功审计按每类
        100 条保留 1 条；失败、超时及其他业务消息不采样。这样保留链路抽查
        能力，同时避免 control_messages 以每小时数十万条持续膨胀。
        """
        if (status == "success"
                and message_type in self._AUDIT_SAMPLED_SUCCESS_TYPES):
            count = self._audit_sample_counters.get(message_type, 0) + 1
            self._audit_sample_counters[message_type] = count
            if count % self._AUDIT_SAMPLE_RATE != 1:
                self._audit_sampled_out += 1
                return
        if len(self._audit_buf) >= self._AUDIT_BUF_MAX:
            self._audit_dropped += 1
            return
        # bulk_insert_mappings 不触发 ORM 列默认值，created_at/updated_at
        # 是 NOT NULL，必须在此显式补齐
        ts = now()
        self._audit_buf.append({
            "message_id": str(uuid.uuid4()),
            "node_id": self._node_id,
            "direction": direction,
            "message_type": message_type,
            "status": status,
            "request_cache_key": request_cache_key,
            "created_at": ts,
            "updated_at": ts,
        })

    def _audit_flush_db(self, rows: list) -> int:
        """把一批审计记录批量落库（同步，供线程池调用）"""
        if not rows:
            return 0
        db = get_db_sync()
        try:
            db.bulk_insert_mappings(ControlMessage, rows)
            db.commit()
            return len(rows)
        except Exception as e:
            db.rollback()
            logger.debug(f"ℹ️ 审计日志批量落库失败({len(rows)}条): {e}")
            return 0
        finally:
            db.close()

    async def _audit_flush_loop(self):
        """后台消费者：定时把审计缓冲攒批写入 DB（DB 操作走线程池）"""
        while True:
            try:
                await asyncio.sleep(self._AUDIT_FLUSH_INTERVAL)
            except asyncio.CancelledError:
                break
            if not self._audit_buf:
                continue
            # 取出一批（切片后重置，避免持锁；单线程事件循环下无竞态）
            batch = self._audit_buf[:self._AUDIT_FLUSH_BATCH]
            self._audit_buf = self._audit_buf[len(batch):]
            try:
                await asyncio.to_thread(self._audit_flush_db, batch)
            except Exception as e:
                logger.debug(f"ℹ️ 审计落库线程异常: {e}")


def _ts() -> int:
    """毫秒时间戳"""
    import time
    return int(time.time() * 1000)


control_client = ControlClient()
