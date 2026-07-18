"""
系统设置接口：读取/更新 app_settings
"""
import logging

from fastapi import APIRouter, Depends, HTTPException

from src.api.v2.deps import get_current_user, require_admin, require_operator
from src.api.v2.schemas import ApiResult, SettingUpdate
from src.database import get_db_sync
from src.models_v2 import AppSetting, LocalUser
from src.models_v2.base import now
from src.services_v2.runtime_config_service import (
    runtime_config_service, SIGN_SECRET_SETTING_KEY,
)

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("")
def list_settings(_: LocalUser = Depends(get_current_user)):
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
def update_setting(
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


# ========================================
# 客户端签名校验密钥（sign_secret）专用端点
# ========================================
# 该密钥与 wasm-sign 内置值一致，仅用于 Worker 侧验签。
# 通过长连接(TLS)下发，页面仅展示"是否已配置"，不回显明文。

@router.get("/sign-secret")
def get_sign_secret(_: LocalUser = Depends(get_current_user)):
    """读取签名密钥配置状态（不回显明文，仅返回是否已设置与长度）"""
    db = get_db_sync()
    try:
        row = db.query(AppSetting).filter(
            AppSetting.key == SIGN_SECRET_SETTING_KEY).first()
        val = (row.value or "") if row else ""
        return ApiResult(data={"configured": bool(val), "length": len(val)})
    finally:
        db.close()


@router.put("/sign-secret")
async def update_sign_secret(
    req: SettingUpdate,
    _: LocalUser = Depends(require_operator),
):
    """更新签名密钥并下发 Worker（值须与 wasm 内置 SIGN_SECRET 一致）"""
    secret = (req.value or "").strip()

    def _save():
        db = get_db_sync()
        try:
            row = db.query(AppSetting).filter(
                AppSetting.key == SIGN_SECRET_SETTING_KEY).first()
            if not row:
                row = AppSetting(
                    key=SIGN_SECRET_SETTING_KEY, value=secret,
                    value_type="secret", is_secret=True,
                    description="客户端请求签名校验密钥（与 wasm 内置值一致）",
                )
                db.add(row)
            else:
                row.value = secret
                row.is_secret = True
                row.value_type = "secret"
                row.updated_at = now()
            db.commit()
        finally:
            db.close()

    import asyncio
    await asyncio.to_thread(_save)
    pushed = await runtime_config_service.push_to_worker()
    return ApiResult(
        message="已保存" + ("，已下发" if pushed else "（Worker 未连接）"),
        data={"configured": bool(secret)},
    )
