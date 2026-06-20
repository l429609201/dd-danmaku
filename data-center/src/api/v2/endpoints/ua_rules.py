"""
UA 限流规则管理接口（S6）

结构化管理 Worker uaConfigs；增删改后通过统一 runtime 配置一次性下发。
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from src.api.v2.deps import get_current_user, require_operator
from src.api.v2.schemas import ApiResult, PageResult, UaRuleCreate, UaRuleUpdate, UaRuleImport
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
        "max_requests_per_hour": r.max_requests_per_hour,
        "max_requests_per_day": r.max_requests_per_day,
        "description": r.description,
        "path_limits": r.path_limits_json or [], "enabled": r.enabled,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _to_worker_object(rows) -> dict:
    """把规则列表导出为 Worker 对象格式 { ua_key: {...} }"""
    out = {}
    for r in rows:
        cfg = {
            "enabled": bool(r.enabled),
            "userAgent": r.user_agent or "",
            "pathLimits": r.path_limits_json or [],
        }
        if r.max_requests_per_hour is not None:
            cfg["maxRequestsPerHour"] = r.max_requests_per_hour
        if r.max_requests_per_day is not None:
            cfg["maxRequestsPerDay"] = r.max_requests_per_day
        if r.description:
            cfg["description"] = r.description
        # 同时保留 maxRequests/windowMs，兼容旧消费方
        cfg["maxRequests"] = r.max_requests
        cfg["windowMs"] = r.window_ms
        out[r.ua_key] = cfg
    return out


def _normalize_import(data) -> list:
    """把导入数据（Worker 对象格式 或 规则数组）归一化为统一 dict 列表"""
    items = []
    if isinstance(data, dict):
        # Worker 对象格式：{ ua_key: { userAgent, maxRequestsPerHour, ... } }
        for ua_key, v in data.items():
            if not isinstance(v, dict):
                continue
            items.append({"ua_key": ua_key, **v})
    elif isinstance(data, list):
        items.extend([d for d in data if isinstance(d, dict)])
    return items


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


@router.get("/export")
async def export_rules(_: LocalUser = Depends(get_current_user)):
    """导出全部 UA 规则为 Worker 对象格式 JSON"""
    db = get_db_sync()
    try:
        rows = db.query(UaLimitRule).order_by(UaLimitRule.id.asc()).all()
        return ApiResult(data=_to_worker_object(rows))
    finally:
        db.close()


def _pick_int(v):
    """安全转 int；None/空返回 None"""
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


@router.post("/import")
async def import_rules(body: UaRuleImport, _: LocalUser = Depends(require_operator)):
    """JSON 导入 UA 规则（Worker 对象格式或规则数组），按 ua_key upsert，导入后下发"""
    items = _normalize_import(body.data)
    if not items:
        raise HTTPException(status_code=400, detail="JSON 为空或格式不正确")

    created = updated = 0
    errors = []
    db = get_db_sync()
    try:
        if body.replace_all:
            db.query(UaLimitRule).delete()
            db.commit()

        for it in items:
            ua_key = str(it.get("ua_key") or "").strip()
            if not ua_key:
                errors.append("缺少 ua_key 的条目已跳过")
                continue
            # 兼容两种字段命名
            user_agent = it.get("userAgent") or it.get("user_agent")
            per_hour = _pick_int(it.get("maxRequestsPerHour"))
            per_day = _pick_int(it.get("maxRequestsPerDay"))
            path_limits = it.get("pathLimits") or it.get("path_limits") or []
            description = it.get("description")
            enabled = it.get("enabled", True)
            # max_requests/window_ms：优先显式值，否则用每小时上限映射为小时窗口
            max_requests = _pick_int(it.get("maxRequests")) or _pick_int(it.get("max_requests"))
            window_ms = _pick_int(it.get("windowMs")) or _pick_int(it.get("window_ms"))
            if max_requests is None:
                max_requests = per_hour if per_hour is not None else 0
                window_ms = window_ms or (3600000 if per_hour is not None else 60000)
            if window_ms is None:
                window_ms = 60000

            row = db.query(UaLimitRule).filter(UaLimitRule.ua_key == ua_key).first()
            if row is None:
                row = UaLimitRule(ua_key=ua_key)
                db.add(row)
                created += 1
            else:
                updated += 1
            row.user_agent = user_agent
            row.max_requests = max_requests
            row.window_ms = window_ms
            row.max_requests_per_hour = per_hour
            row.max_requests_per_day = per_day
            row.description = description
            row.path_limits_json = path_limits
            row.enabled = bool(enabled)
            row.updated_at = now()
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"导入失败: {e}")
    finally:
        db.close()

    pushed = await runtime_config_service.push_to_worker()
    msg = f"导入完成：新增 {created}，更新 {updated}"
    if errors:
        msg += f"，{len(errors)} 条跳过"
    msg += "，已下发" if pushed else "（Worker 未连接）"
    return ApiResult(message=msg, data={"created": created, "updated": updated, "errors": errors})
