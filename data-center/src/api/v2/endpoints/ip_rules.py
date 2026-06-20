"""
IP 黑白名单管理接口（S4）

增删改后自动通过长连接下发给 Worker；下发失败不影响本地持久化。
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from src.api.v2.deps import get_current_user, require_operator
from src.api.v2.schemas import ApiResult, IpRuleCreate, IpRuleUpdate, PageResult
from src.database import get_db_sync
from src.models_v2 import IpRule, LocalUser
from src.models_v2.base import now
from src.services_v2.runtime_config_service import runtime_config_service

logger = logging.getLogger(__name__)
router = APIRouter()


def _brief(r: IpRule) -> dict:
    return {
        "id": r.id, "ip_or_cidr": r.ip_or_cidr, "rule_type": r.rule_type,
        "reason": r.reason, "enabled": r.enabled, "created_by": r.created_by,
        "expires_at": r.expires_at.isoformat() if r.expires_at else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


@router.get("")
async def list_rules(
    rule_type: Optional[str] = None,
    keyword: Optional[str] = None,
    page: int = 1, page_size: int = Query(50, le=200),
    _: LocalUser = Depends(get_current_user),
):
    """IP 规则列表"""
    db = get_db_sync()
    try:
        q = db.query(IpRule)
        if rule_type:
            q = q.filter(IpRule.rule_type == rule_type)
        if keyword:
            q = q.filter(IpRule.ip_or_cidr.like(f"%{keyword}%"))
        total = q.count()
        rows = q.order_by(IpRule.id.desc()) \
                .offset((page - 1) * page_size).limit(page_size).all()
        return PageResult(total=total, items=[_brief(r) for r in rows])
    finally:
        db.close()


@router.post("")
async def create_rule(body: IpRuleCreate, user: LocalUser = Depends(require_operator)):
    """新增 IP 规则并下发 Worker"""
    if body.rule_type not in ("black", "white"):
        raise HTTPException(status_code=400, detail="rule_type 只能是 black 或 white")
    db = get_db_sync()
    try:
        if db.query(IpRule).filter(IpRule.ip_or_cidr == body.ip_or_cidr).first():
            raise HTTPException(status_code=409, detail="该 IP/CIDR 规则已存在")
        rule = IpRule(
            ip_or_cidr=body.ip_or_cidr.strip(), rule_type=body.rule_type,
            reason=body.reason, enabled=body.enabled,
            created_by=user.username, expires_at=body.expires_at,
        )
        db.add(rule)
        db.commit()
        db.refresh(rule)
        data = _brief(rule)
    finally:
        db.close()
    pushed = await runtime_config_service.push_to_worker()
    return ApiResult(message="创建成功" + ("，已下发" if pushed else "（Worker 未连接，稍后自动同步）"), data=data)


@router.put("/{rule_id}")
async def update_rule(rule_id: int, body: IpRuleUpdate,
                      _: LocalUser = Depends(require_operator)):
    """更新 IP 规则并下发 Worker"""
    db = get_db_sync()
    try:
        rule = db.query(IpRule).filter(IpRule.id == rule_id).first()
        if not rule:
            raise HTTPException(status_code=404, detail="规则不存在")
        if body.rule_type is not None:
            if body.rule_type not in ("black", "white"):
                raise HTTPException(status_code=400, detail="rule_type 非法")
            rule.rule_type = body.rule_type
        if body.reason is not None:
            rule.reason = body.reason
        if body.enabled is not None:
            rule.enabled = body.enabled
        if body.expires_at is not None:
            rule.expires_at = body.expires_at
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
    """删除 IP 规则并下发 Worker"""
    db = get_db_sync()
    try:
        rule = db.query(IpRule).filter(IpRule.id == rule_id).first()
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
    """手动重新下发当前全部黑白名单"""
    pushed = await runtime_config_service.push_to_worker()
    if not pushed:
        return ApiResult(success=False, message="Worker 未连接或下发超时")
    return ApiResult(message="已重新下发")
