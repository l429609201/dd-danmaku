"""
系统设置接口：读取/更新 app_settings
"""
import logging

from fastapi import APIRouter, Depends, HTTPException

from src.api.v2.deps import get_current_user, require_admin
from src.api.v2.schemas import ApiResult, SettingUpdate
from src.database import get_db_sync
from src.models_v2 import AppSetting, LocalUser
from src.models_v2.base import now

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("")
async def list_settings(_: LocalUser = Depends(get_current_user)):
    """获取所有设置（敏感项脱敏）"""
    db = get_db_sync()
    try:
        rows = db.query(AppSetting).all()
        items = [{
            "key": r.key,
            "value": "******" if r.is_secret and r.value else r.value,
            "value_type": r.value_type,
            "description": r.description,
            "is_secret": r.is_secret,
        } for r in rows]
        return ApiResult(data=items)
    finally:
        db.close()


@router.put("/{key}")
async def update_setting(
    key: str, req: SettingUpdate,
    _: LocalUser = Depends(require_admin),
):
    """更新单个设置项"""
    db = get_db_sync()
    try:
        row = db.query(AppSetting).filter(AppSetting.key == key).first()
        if not row:
            raise HTTPException(status_code=404, detail="设置项不存在")
        row.value = req.value
        row.updated_at = now()
        db.commit()
        return ApiResult(message="已更新")
    finally:
        db.close()
