"""
用户允许名单池管理接口

- 用户组 CRUD（本地端维护，UA 规则通过 user_group_id 绑定）
- 增删改后下发 Worker（复用 runtime_config_service.push_to_worker）

与签名密钥池的区别：用户名不是密钥，故列表直接返回明文，无脱敏端点。
"""
import asyncio
import logging

from fastapi import APIRouter, Body, Depends, HTTPException

from src.api.v2.deps import get_current_user, require_operator
from src.api.v2.schemas import ApiResult
from src.models_v2 import LocalUser
from src.services_v2.user_allow_pool_service import user_allow_pool_service, obfuscate_user
from src.services_v2.runtime_config_service import runtime_config_service

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/obfuscate")
def obfuscate(body: dict = Body(...), _: LocalUser = Depends(get_current_user)):
    """
    把 Emby 原生用户 ID 换算成客户端实际上报的混淆值，供填名单用。

    客户端送的 X-Ddd-User 是 wasm 混淆后的值，手工算不现实，故提供此换算接口。
    brand_mark / obf_key 必须与 wasm-sign/assembly/config.ts 里编译进 wasm 的值一致，
    不传则取该组已配置的值。
    """
    user_ids = body.get("user_ids") or []
    if isinstance(user_ids, str):
        # 前端文本域可能用换行或逗号分隔，统一切分
        user_ids = [x.strip() for part in user_ids.replace(",", "\n").split("\n") for x in [part]]
    user_ids = [str(x).strip() for x in user_ids if str(x).strip()]
    if not user_ids:
        raise HTTPException(status_code=400, detail="user_ids 不能为空")

    brand_mark = str(body.get("brand_mark") or "").strip()
    obf_key = str(body.get("obf_key") or "").strip()
    # 未显式传参时，回退取该组已存的混淆参数
    group_id = str(body.get("group_id") or "").strip()
    if (not brand_mark or not obf_key) and group_id:
        for g in user_allow_pool_service.list_groups():
            if g.get("group_id") == group_id:
                brand_mark = brand_mark or g.get("brand_mark") or ""
                obf_key = obf_key or g.get("obf_key") or ""
                break
    if not brand_mark or not obf_key:
        raise HTTPException(status_code=400, detail="brand_mark 与 obf_key 都必须有值")

    return ApiResult(data={
        "items": [
            {"user_id": uid, "obfuscated": obfuscate_user(uid, brand_mark, obf_key)}
            for uid in user_ids
        ]
    })


@router.get("")
def list_groups(_: LocalUser = Depends(get_current_user)):
    """用户允许名单组列表（含用户数量统计）"""
    return ApiResult(data={"items": user_allow_pool_service.list_groups()})


@router.post("")
async def create_group(body: dict = Body(...), _: LocalUser = Depends(require_operator)):
    """新增用户组并下发 Worker"""
    try:
        data = await asyncio.to_thread(user_allow_pool_service.create_group, body)
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
    """更新用户组并下发 Worker"""
    try:
        data = await asyncio.to_thread(user_allow_pool_service.update_group, pk, body)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    pushed = await runtime_config_service.push_to_worker()
    return ApiResult(
        message="更新成功" + ("，已下发" if pushed else "（Worker 未连接，稍后自动同步）"),
        data=data,
    )


@router.delete("/{pk}")
async def delete_group(pk: int, _: LocalUser = Depends(require_operator)):
    """删除用户组并下发 Worker"""
    ok = await asyncio.to_thread(user_allow_pool_service.delete_group, pk)
    if not ok:
        raise HTTPException(status_code=404, detail="用户组不存在")
    pushed = await runtime_config_service.push_to_worker()
    return ApiResult(message="删除成功" + ("，已下发" if pushed else "（Worker 未连接）"))
