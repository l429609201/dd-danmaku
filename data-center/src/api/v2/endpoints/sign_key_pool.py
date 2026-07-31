"""
客户端签名密钥池管理接口

- 签名密钥组 CRUD（本地端维护）
- 增删改后下发 Worker（复用 runtime_config_service.push_to_worker）
- 提供随机生成密钥辅助端点
"""
import asyncio
import base64
import logging
import secrets

from fastapi import APIRouter, Body, Depends, HTTPException

from src.api.v2.deps import get_current_user, require_operator
from src.api.v2.schemas import ApiResult
from src.models_v2 import LocalUser
from src.services_v2.sign_key_pool_service import sign_key_pool_service
from src.services_v2.runtime_config_service import runtime_config_service

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("")
def list_groups(_: LocalUser = Depends(get_current_user)):
    """签名密钥组列表（secret 脱敏）"""
    return ApiResult(data={"items": sign_key_pool_service.list_groups(mask=True)})


@router.get("/{pk}/secret")
def get_secret(pk: int, _: LocalUser = Depends(require_operator)):
    """获取指定密钥组的明文 secret（operator 权限，供运维复制回填 wasm config）"""
    try:
        secret = sign_key_pool_service.get_secret(pk)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return ApiResult(data={"secret": secret})


@router.get("/gen")
def gen_secret(_: LocalUser = Depends(get_current_user)):
    """随机生成一个 48 位 base64url 签名密钥（与 wasm-sign 生成规格一致）"""
    raw = secrets.token_bytes(36)
    val = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    return ApiResult(data={"secret": val})


@router.post("")
async def create_group(body: dict = Body(...), _: LocalUser = Depends(require_operator)):
    """新增签名密钥组并下发 Worker"""
    try:
        data = await asyncio.to_thread(sign_key_pool_service.create_group, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    pushed = await runtime_config_service.push_to_worker()
    return ApiResult(
        message="创建成功" + ("，已下发" if pushed else "（Worker 未连接，稍后自动同步）"),
        data=data,
    )


@router.put("/{pk}")
async def update_group(pk: int, body: dict = Body(...),
                       _: LocalUser = Depends(require_operator)):
    """更新签名密钥组并下发 Worker"""
    try:
        data = await asyncio.to_thread(sign_key_pool_service.update_group, pk, body)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    pushed = await runtime_config_service.push_to_worker()
    return ApiResult(
        message="更新成功" + ("，已下发" if pushed else "（Worker 未连接，稍后自动同步）"),
        data=data,
    )


@router.delete("/{pk}")
async def delete_group(pk: int, _: LocalUser = Depends(require_operator)):
    """删除签名密钥组并下发 Worker"""
    ok = await asyncio.to_thread(sign_key_pool_service.delete_group, pk)
    if not ok:
        raise HTTPException(status_code=404, detail="密钥组不存在")
    pushed = await runtime_config_service.push_to_worker()
    return ApiResult(message="删除成功" + ("，已下发" if pushed else "（Worker 未连接）"))
