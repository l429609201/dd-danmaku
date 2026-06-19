"""
Worker 控制通道接口：节点状态、消息审计、配置下发、重连
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query

from src.api.v2.deps import get_current_user, require_admin, require_operator
from src.api.v2.schemas import ApiResult, ConfigApplyRequest, PageResult
from src.database import get_db_sync
from src.models_v2 import ControlNode, ControlMessage, LocalUser
from src.services_v2.control_client import control_client

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/nodes")
async def list_nodes(_: LocalUser = Depends(get_current_user)):
    """Worker 长连接节点状态"""
    db = get_db_sync()
    try:
        rows = db.query(ControlNode).order_by(ControlNode.last_seen_at.desc()).all()
        items = [{
            "id": r.id, "node_id": r.node_id, "worker_id": r.worker_id,
            "worker_url": r.worker_url, "connected": r.connected,
            "protocol_version": r.protocol_version,
            "last_connected_at": r.last_connected_at.isoformat() if r.last_connected_at else None,
            "last_seen_at": r.last_seen_at.isoformat() if r.last_seen_at else None,
            "latency_ms": r.latency_ms, "reconnect_count": r.reconnect_count,
            "last_error": r.last_error,
        } for r in rows]
        # 附带运行时实际连接状态
        return ApiResult(data={"nodes": items, "live_connected": control_client.connected})
    finally:
        db.close()


@router.get("/messages")
async def list_messages(
    node_id: Optional[str] = None,
    message_type: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1, page_size: int = Query(50, le=200),
    _: LocalUser = Depends(get_current_user),
):
    """长连接消息审计"""
    db = get_db_sync()
    try:
        q = db.query(ControlMessage)
        if node_id:
            q = q.filter(ControlMessage.node_id == node_id)
        if message_type:
            q = q.filter(ControlMessage.message_type == message_type)
        if status:
            q = q.filter(ControlMessage.status == status)
        total = q.count()
        rows = q.order_by(ControlMessage.created_at.desc()) \
                .offset((page - 1) * page_size).limit(page_size).all()
        items = [{
            "id": r.id, "message_id": r.message_id, "node_id": r.node_id,
            "direction": r.direction, "message_type": r.message_type,
            "status": r.status, "request_cache_key": r.request_cache_key,
            "duration_ms": r.duration_ms,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in rows]
        return PageResult(total=total, items=items)
    finally:
        db.close()


@router.post("/config/apply")
async def apply_config(
    req: ConfigApplyRequest,
    _: LocalUser = Depends(require_operator),
):
    """向 Worker 下发配置（通过长连接）"""
    result = await control_client.request("config.apply", req.model_dump(exclude_none=True))
    if result is None:
        return ApiResult(success=False, message="Worker 未连接或下发超时")
    return ApiResult(data=result)


@router.post("/reconnect")
async def reconnect(_: LocalUser = Depends(require_admin)):
    """手动重连本地 WebSocket 客户端"""
    await control_client.stop()
    await control_client.start()
    return ApiResult(message="已触发重连")
