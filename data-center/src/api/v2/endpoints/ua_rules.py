"""
UA 限流规则管理接口（S6）

结构化管理 Worker uaConfigs；增删改后通过统一 runtime 配置一次性下发。
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from src.api.v2.deps import get_current_user, require_operator
from src.api.v2.schemas import ApiResult, PageResult, UaRuleCreate, UaRuleUpdate
from src.database import get_db_sync
from src.models_v2 import UaLimitRule, LocalUser
from src.models_v2.base import now
from src.services_v2.runtime_config_service import runtime_config_service

logger = logging.getLogger(__name__)
router = APIRouter()


def _brief(r: UaLimitRule) -> dict:
    return {
        "id": r.id, "ua_key": r.ua_key, "user_agent": r.user_agent,
        "max_requests": r.max_requests, "window_ms": r.window_ms,
        "path_limits": r.path_limits_json or [], "enabled": r.enabled,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


@router.get("")
async def list_rules(
    keyword: Optional[str] = None,
    page: int = 1, page_size: int = Query(50, le=200),
    _: LocalUser = Depends(get_current_user),
):
    """UA 限流规则列表"""
    db = get_db_sync()
    try:
        q = db.query(UaLimitRule)
        if keyword:
            q = q.filter(UaLimitRule.ua_key.like(f"%{keyword}%"))
        total = q.count()
        rows = q.order_by(UaLimitRule.id.desc()) \
                .offset((page - 1) * page_size).limit(page_size).all()
        return PageResult(total=total, items=[_brief(r) for r in rows])
    finally:
        db.close()


@router.post("")
async def create_rule(body: UaRuleCreate, _: LocalUser = Depends(require_operator)):
    """新增 UA 限流规则并下发 Worker"""
    db = get_db_sync()
    try:
        if db.query(UaLimitRule).filter(UaLimitRule.ua_key == body.ua_key).first():
            raise HTTPException(status_code=409, detail="该 ua_key 已存在")
        rule = UaLimitRule(
            ua_key=body.ua_key.strip(), user_agent=body.user_agent,
            max_requests=body.max_requests, window_ms=body.window_ms,
            path_limits_json=body.path_limits or [], enabled=body.enabled,
        )
        db.add(rule)
        db.commit()
        db.refresh(rule)
        data = _brief(rule)
    finally:
        db.close()
    pushed = await runtime_config_service.push_to_worker()
    return ApiResult(message="创建成功" + ("，已下发" if pushed else "（Worker 未连接）"), data=data)


@router.put("/{rule_id}")
async def update_rule(rule_id: int, body: UaRuleUpdate,
                      _: LocalUser = Depends(require_operator)):
    """更新 UA 限流规则并下发 Worker"""
    db = get_db_sync()
    try:
        rule = db.query(UaLimitRule).filter(UaLimitRule.id == rule_id).first()
        if not rule:
            raise HTTPException(status_code=404, detail="规则不存在")
        if body.user_agent is not None:
            rule.user_agent = body.user_agent
        if body.max_requests is not None:
            rule.max_requests = body.max_requests
        if body.window_ms is not None:
            rule.window_ms = body.window_ms
        if body.path_limits is not None:
            rule.path_limits_json = body.path_limits
        if body.enabled is not None:
            rule.enabled = body.enabled
        rule.updated_at = now()
        db.commit()
        db.refresh(rule)
        data = _brief(rule)
    finally:
        db.close()
    pushed = await runtime_config_service.push_to_worker()
    return ApiResult(message="更新成功" + ("，已下发" if pushed else "（Worker 未连接）"), data=data)


@router.delete("/{rule_id}")
async def delete_rule(rule_id: int, _: LocalUser = Depends(require_operator)):
    """删除 UA 限流规则并下发 Worker"""
    db = get_db_sync()
    try:
        rule = db.query(UaLimitRule).filter(UaLimitRule.id == rule_id).first()
        if not rule:
            raise HTTPException(status_code=404, detail="规则不存在")
        db.delete(rule)
        db.commit()
    finally:
        db.close()
    pushed = await runtime_config_service.push_to_worker()
    return ApiResult(message="删除成功" + ("，已下发" if pushed else "（Worker 未连接）"))


@router.post("/resync")
async def resync(_: LocalUser = Depends(require_operator)):
    """手动重新下发完整 runtime 配置（IP 黑白名单 + UA 限流）"""
    pushed = await runtime_config_service.push_to_worker()
    if not pushed:
        return ApiResult(success=False, message="Worker 未连接或下发超时")
    return ApiResult(message="已重新下发")
