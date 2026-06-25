"""
数据清理管理接口

- 列出/更新可配置清理策略（cleanup_policy 表）
- 立即清理（可指定表）
- 定时任务全局开关与间隔配置
"""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from src.api.v2.deps import get_current_user, require_operator
from src.api.v2.schemas import ApiResult
from src.database import get_db_sync
from src.models_v2 import CleanupPolicy, LocalUser, AppSetting
from src.models_v2.base import now
from src.services_v2.cleanup_service import cleanup_service, TABLE_REGISTRY

logger = logging.getLogger(__name__)
router = APIRouter()


class PolicyUpdate(BaseModel):
    """单表策略更新"""
    enabled: Optional[bool] = None
    retention_days: Optional[int] = None


class ScheduleUpdate(BaseModel):
    """定时任务配置"""
    enabled: Optional[bool] = None
    interval_seconds: Optional[int] = None


class RunRequest(BaseModel):
    """立即清理请求；table_keys 为空表示清所有启用的表"""
    table_keys: Optional[List[str]] = None


def _policy_dict(p: CleanupPolicy) -> dict:
    return {
        "table_key": p.table_key, "display_name": p.display_name,
        "enabled": p.enabled, "retention_days": p.retention_days,
        "is_safe": p.is_safe, "expired_only": p.expired_only,
        "last_cleanup_at": p.last_cleanup_at.isoformat() if p.last_cleanup_at else None,
        "last_deleted": p.last_deleted,
    }


@router.get("/policies")
def list_policies(_: LocalUser = Depends(get_current_user)):
    """列出所有清理策略 + 定时配置 + 各表当前行数"""
    cleanup_service.ensure_default_policies()
    db = get_db_sync()
    try:
        policies = db.query(CleanupPolicy).all()
        items = []
        for p in policies:
            d = _policy_dict(p)
            # 附带当前行数，便于前端展示
            reg = TABLE_REGISTRY.get(p.table_key)
            if reg:
                model = reg[0]
                try:
                    d["row_count"] = db.query(model).count()
                except Exception:
                    d["row_count"] = None
            items.append(d)
        # 定时配置
        sched = {
            "enabled": _get_setting_bool(db, "cleanup_enabled", True),
            "interval_seconds": _get_setting_int(db, "cleanup_interval_seconds", 3600),
        }
        return ApiResult(data={"policies": items, "schedule": sched})
    finally:
        db.close()


@router.put("/policies/{table_key}")
def update_policy(table_key: str, body: PolicyUpdate,
                        _: LocalUser = Depends(require_operator)):
    """更新单表清理策略（启用/保留天数）"""
    if table_key not in TABLE_REGISTRY:
        return ApiResult(success=False, message="未知的表标识")
    db = get_db_sync()
    try:
        p = db.query(CleanupPolicy).filter(
            CleanupPolicy.table_key == table_key).first()
        if not p:
            return ApiResult(success=False, message="策略不存在")
        if body.enabled is not None:
            p.enabled = body.enabled
        if body.retention_days is not None:
            p.retention_days = max(0, body.retention_days)
        p.updated_at = now()
        db.commit()
        return ApiResult(message="已更新", data=_policy_dict(p))
    finally:
        db.close()


@router.put("/schedule")
def update_schedule(body: ScheduleUpdate,
                          _: LocalUser = Depends(require_operator)):
    """更新定时任务全局开关与间隔"""
    db = get_db_sync()
    try:
        if body.enabled is not None:
            _set_setting(db, "cleanup_enabled", "true" if body.enabled else "false")
        if body.interval_seconds is not None:
            _set_setting(db, "cleanup_interval_seconds", str(max(60, body.interval_seconds)))
        db.commit()
        return ApiResult(message="定时配置已更新")
    finally:
        db.close()


@router.post("/run")
async def run_cleanup(body: RunRequest, _: LocalUser = Depends(require_operator)):
    """立即执行清理；table_keys 指定则只清这些表，否则清所有启用的表"""
    result = await cleanup_service.cleanup_once(only_keys=body.table_keys)
    return ApiResult(message="清理完成", data=result)


# ---------- AppSetting 读写辅助 ----------
def _get_setting_bool(db, key: str, default: bool) -> bool:
    s = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not s or s.value is None:
        return default
    return str(s.value).lower() in ("true", "1", "yes")


def _get_setting_int(db, key: str, default: int) -> int:
    s = db.query(AppSetting).filter(AppSetting.key == key).first()
    try:
        return int(s.value) if s and s.value is not None else default
    except (TypeError, ValueError):
        return default


def _set_setting(db, key: str, value: str):
    s = db.query(AppSetting).filter(AppSetting.key == key).first()
    if s:
        s.value = value
    else:
        db.add(AppSetting(key=key, value=value))
