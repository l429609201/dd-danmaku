"""OAuth 配置管理端点（admin 专用）

改动经 config.apply 下发到 DO storage，Worker 优先读下发值、env 仅作冷启动兜底，
因此本表留空时行为与改造前一致（灰度安全）。
"""
import asyncio

from fastapi import APIRouter, Depends, HTTPException

from src.api.v2.deps import require_admin
from src.api.v2.schemas import ApiResult
from src.database import get_db_sync
from src.models_v2 import LocalUser, OAuthConfig

router = APIRouter()


def _list_rows():
    """同步查询所有配置（供线程池调用，避免阻塞事件循环）"""
    from src.services_v2.oauth_config_service import oauth_config_service
    db = get_db_sync()
    try:
        rows = db.query(OAuthConfig).order_by(OAuthConfig.id.asc()).all()
        return [oauth_config_service.to_brief(r) for r in rows]
    finally:
        db.close()


@router.get("")
async def list_oauth_configs(_: LocalUser = Depends(require_admin)):
    """列出所有 OAuth 配置（jwtSecret/clientSecret 已脱敏）"""
    items = await asyncio.to_thread(_list_rows)
    return ApiResult(data={"items": items})


@router.post("")
async def create_oauth_config(body: dict, _: LocalUser = Depends(require_admin)):
    """新建 OAuth 配置"""
    from src.services_v2.oauth_config_service import oauth_config_service
    row = await asyncio.to_thread(oauth_config_service.create, body)
    return ApiResult(data=oauth_config_service.to_brief(row), message="创建成功")


@router.put("/{pk}")
async def update_oauth_config(pk: int, body: dict, _: LocalUser = Depends(require_admin)):
    """更新 OAuth 配置（jwtSecret/clientSecret 传 '***REDACTED***' 则保留旧值）"""
    from src.services_v2.oauth_config_service import oauth_config_service
    row = await asyncio.to_thread(oauth_config_service.update, pk, body)
    if row is None:
        raise HTTPException(status_code=404, detail="配置不存在")
    return ApiResult(data=oauth_config_service.to_brief(row), message="更新成功")


@router.delete("/{pk}")
async def delete_oauth_config(pk: int, _: LocalUser = Depends(require_admin)):
    """删除 OAuth 配置"""
    from src.services_v2.oauth_config_service import oauth_config_service
    ok = await asyncio.to_thread(oauth_config_service.delete, pk)
    if not ok:
        raise HTTPException(status_code=404, detail="配置不存在")
    return ApiResult(message="删除成功")


@router.post("/push")
async def push_oauth_config(_: LocalUser = Depends(require_admin)):
    """手动触发 OAuth 配置下发（仅推送，不重推其他配置）"""
    from src.services_v2.oauth_config_service import oauth_config_service
    from src.services_v2.control_client import control_client
    payload = await asyncio.to_thread(oauth_config_service.build_payload)
    if payload is None:
        return ApiResult(message="无生效的 OAuth 配置，Worker 将继续使用 env 兜底")
    result = await control_client.request("config.apply", {"oauth_config": payload})
    ok = bool(result and result.get("success"))
    return ApiResult(
        message="下发成功" if ok else "下发失败（Worker 未连接）",
        data={"pushed": ok}
    )
