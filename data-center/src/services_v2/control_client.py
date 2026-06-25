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
from src.services_v2.entity_service import entity_index_service, episode_link_service
from src.services_v2.ip_stats_service import ip_stats_service
from src.services_v2.worker_log_service import worker_log_service
from src.services_v2.runtime_event_service import runtime_event_service
from src.services_v2.abuse_service import abuse_service
from src.services_v2.metrics_service import metrics_service
from src.services_v2.comment_store_service import comment_store_service

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
        self._task = asyncio.create_task(self._run_loop())
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
                    ping_interval=20, ping_timeout=20, open_timeout=10,
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
        """接收并分发消息"""
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except Exception:
                logger.warning("⚠️ 收到非法 JSON 消息，忽略")
                continue
            await self._dispatch(msg)

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
        elif msg_type == "stats.report":
            await self._handle_stats_report(msg_id, payload)
        elif msg_type == "log.report":
            await self._handle_log_report(msg_id, payload)
        elif msg_type == "abuse.report":
            await self._handle_abuse_report(msg_id, payload)
        elif msg_type == "metrics.report":
            await self._handle_metrics_report(msg_id, payload)
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
        # prefetch 标记：内存未命中的主动预查，命中才有日志价值
        log_miss = not bool(payload.get("prefetch"))
        result = await cache_service.get(
            cache_key, worker_request_id=worker_request_id,
            client_ip=client_ip, log_miss=log_miss,
        )
        hit = bool(result and result.get("hit"))
        await self._send({
            "id": msg_id, "type": "cache.get.result",
            "timestamp": _ts(),
            "payload": result if hit else {"hit": False},
        })
        self._audit("worker_to_local", "cache.get",
                    "success" if hit else "success",
                    request_cache_key=cache_key)

    async def _handle_cache_upsert(self, msg_id, payload):
        """Worker 200 响应：写入本地缓存 + 解析实体/集数链接"""
        ok = await cache_service.upsert(payload)
        # 解析实体与集数链接（失败不影响 upsert 结果）
        try:
            api_path = payload.get("api_path", "")
            cache_key = payload.get("cache_key", "")
            body = payload.get("body") or ""
            entity_index_service.index_from_response(api_path, cache_key, body)
            episode_link_service.link_from_response(api_path, cache_key, body)
        except Exception as e:
            logger.warning(f"⚠️ 实体/集数解析失败: {e}")
        await self._send({
            "id": msg_id, "type": "cache.upsert.result",
            "timestamp": _ts(),
            "payload": {"success": ok},
        })
        self._audit("worker_to_local", "cache.upsert",
                    "success" if ok else "failed",
                    request_cache_key=payload.get("cache_key"))

    async def _handle_stats_report(self, msg_id, payload):
        """Worker 主动上报 IP/限流统计：落库 current + snapshot"""
        ip_stats = payload.get("ip_stats") or []
        worker_id = payload.get("worker_id", "worker-1")
        saved = ip_stats_service.ingest_report(worker_id, ip_stats)
        await self._send({
            "id": msg_id, "type": "stats.report.result",
            "timestamp": _ts(), "payload": {"success": True, "saved": saved},
        })
        self._audit("worker_to_local", "stats.report", "success")

    async def _handle_log_report(self, msg_id, payload):
        """Worker 主动上报日志：落库 worker_request_logs + SSE 广播"""
        logs = payload.get("logs") or []
        worker_id = payload.get("worker_id", "worker-1")
        saved = worker_log_service.ingest_report(worker_id, logs)
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
        """调度一次配置回灌后台任务；已有未完成任务时跳过，避免任务堆叠"""
        if self._resync_task and not self._resync_task.done():
            return

        async def _run():
            try:
                # 延迟导入避免循环依赖（runtime_config_service 依赖 control_client）
                from src.services_v2.runtime_config_service import runtime_config_service
                await runtime_config_service.push_to_worker()
            except Exception as e:
                logger.warning(f"⚠️ 滥用封禁回灌下发失败: {e}")

        self._resync_task = asyncio.create_task(_run())

    async def _handle_metrics_report(self, msg_id, payload):
        """Worker 上报运行指标快照：落库 worker_metrics_snapshot"""
        metrics = payload.get("metrics") or {}
        worker_id = payload.get("worker_id", "worker-1")
        ok = metrics_service.ingest_report(
            worker_id, metrics,
            total_lifetime=payload.get("total_requests_lifetime", 0),
            api_cache_size=payload.get("api_cache_size", 0),
        )
        await self._send({
            "id": msg_id, "type": "metrics.report.result",
            "timestamp": _ts(), "payload": {"success": ok},
        })
        self._audit("worker_to_local", "metrics.report", "success" if ok else "failed")

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
        """写消息审计，失败不影响主流程"""
        try:
            db = get_db_sync()
            try:
                db.add(ControlMessage(
                    message_id=str(uuid.uuid4()),
                    node_id=self._node_id,
                    direction=direction,
                    message_type=message_type,
                    status=status,
                    request_cache_key=request_cache_key,
                ))
                db.commit()
            finally:
                db.close()
        except Exception:
            pass


def _ts() -> int:
    """毫秒时间戳"""
    import time
    return int(time.time() * 1000)


control_client = ControlClient()
