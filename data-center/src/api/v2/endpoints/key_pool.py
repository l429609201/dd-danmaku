"""
弹弹play 密钥池管理接口

- 密钥 CRUD（本地端维护）
- 增删改后下发 Worker（复用 runtime_config_service.push_to_worker）
- 查询 Worker 上报的密钥限流状态
"""
import asyncio
import logging

from fastapi import APIRouter, Body, Depends, HTTPException

from src.api.v2.deps import get_current_user, require_operator
from src.api.v2.schemas import ApiResult
from src.models_v2 import LocalUser
from src.services_v2.key_pool_service import key_pool_service
from src.services_v2.runtime_config_service import runtime_config_service

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("")
def list_keys(_: LocalUser = Depends(get_current_user)):
    """密钥列表（app_secret 脱敏）"""
    return ApiResult(data={"items": key_pool_service.list_keys(mask=True)})


@router.get("/ua-keys")
def list_ua_keys(_: LocalUser = Depends(get_current_user)):
    """可绑定的 ua_key 列表（供专属密钥下拉）"""
    return ApiResult(data={"items": key_pool_service.list_ua_keys()})


@router.get("/states")
def list_states(_: LocalUser = Depends(get_current_user)):
    """各 Worker 上报的密钥限流状态"""
    return ApiResult(data={"items": key_pool_service.get_key_states()})


@router.post("")
async def create_key(body: dict = Body(...), _: LocalUser = Depends(require_operator)):
    """新增密钥并下发 Worker"""
    try:
        data = await asyncio.to_thread(key_pool_service.create_key, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    pushed = await runtime_config_service.push_to_worker()
    return ApiResult(message="创建成功" + ("，已下发" if pushed else "（Worker 未连接，稍后自动同步）"), data=data)


@router.put("/{key_pk}")
async def update_key(key_pk: int, body: dict = Body(...),
                     _: LocalUser = Depends(require_operator)):
    """更新密钥并下发 Worker"""
    try:
        data = await asyncio.to_thread(key_pool_service.update_key, key_pk, body)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    pushed = await runtime_config_service.push_to_worker()
    return ApiResult(message="更新成功" + ("，已下发" if pushed else "（Worker 未连接）"), data=data)


@router.delete("/{key_pk}")
async def delete_key(key_pk: int, _: LocalUser = Depends(require_operator)):
    """删除密钥并下发 Worker"""
    ok = await asyncio.to_thread(key_pool_service.delete_key, key_pk)
    if not ok:
        raise HTTPException(status_code=404, detail="密钥不存在")
    pushed = await runtime_config_service.push_to_worker()
    return ApiResult(message="删除成功" + ("，已下发" if pushed else "（Worker 未连接）"))


@router.get("/export")
def export_keys(_: LocalUser = Depends(get_current_user)):
    """导出全部密钥为 env APP_KEY_POOL 同构 JSON"""
    return ApiResult(data=key_pool_service.export_keys())


@router.post("/import")
async def import_keys(body: dict = Body(...),
                      _: LocalUser = Depends(require_operator)):
    """JSON 导入密钥（{keys:[...]} / 数组 / 对象格式），导入后下发 Worker

    body: { data: <JSON>, replace_all: bool }
    """
    data = body.get("data")
    replace_all = bool(body.get("replace_all"))
    if data is None:
        raise HTTPException(status_code=400, detail="缺少 data 字段")
    try:
        stat = await asyncio.to_thread(
            key_pool_service.import_keys, data, replace_all)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"导入失败: {e}")
    pushed = await runtime_config_service.push_to_worker()
    msg = f"导入完成：新增 {stat['created']}，更新 {stat['updated']}，跳过 {stat['errors']}"
    msg += "，已下发" if pushed else "（Worker 未连接，稍后自动同步）"
    return ApiResult(message=msg, data=stat)


@router.post("/resync")
async def resync(_: LocalUser = Depends(require_operator)):
    """手动重新下发当前全部密钥"""
    pushed = await runtime_config_service.push_to_worker()
    if not pushed:
        return ApiResult(success=False, message="Worker 未连接或下发超时")
    return ApiResult(message="已重新下发")
