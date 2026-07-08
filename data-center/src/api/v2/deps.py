"""
API v2 依赖注入：JWT 认证 + 角色权限校验

通过 Authorization: Bearer <token> 解析当前用户。
角色等级：viewer < operator < admin。
"""
import asyncio
import logging
from typing import Optional

from fastapi import Depends, Header, HTTPException

from src.models_v2 import LocalUser
from src.services_v2.auth_service import auth_service_v2, has_role

logger = logging.getLogger(__name__)


async def get_current_user(
    authorization: Optional[str] = Header(None),
) -> LocalUser:
    """从 Bearer token 解析当前用户"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未提供认证令牌")
    token = authorization.split(" ", 1)[1]
    # 同步 DB 校验放线程池，避免阻塞事件循环（每个请求都走这里）
    user = await asyncio.to_thread(auth_service_v2.validate_jwt, token)
    if not user:
        raise HTTPException(status_code=401, detail="令牌无效或已过期")
    return user


def require_role(required: str):
    """生成一个要求指定最低角色的依赖"""
    async def _checker(user: LocalUser = Depends(get_current_user)) -> LocalUser:
        if not has_role(user, required):
            raise HTTPException(status_code=403, detail=f"需要 {required} 及以上权限")
        return user
    return _checker


# 常用角色依赖
require_admin = require_role("admin")
require_operator = require_role("operator")
require_viewer = require_role("viewer")


async def verify_external_token(
    x_external_token: Optional[str] = Header(None),
) -> bool:
    """外部控制 API 独立密钥校验（MCP/诊断专用，独立于用户 JWT）。

    请求头：X-External-Token: <外部控制密钥>
    """
    from src.services_v2.external_control_service import external_control_auth
    # 同步 DB 读取放线程池，避免阻塞事件循环
    ok = await asyncio.to_thread(external_control_auth.verify, x_external_token or "")
    if not ok:
        raise HTTPException(status_code=401, detail="外部控制密钥无效")
    return True
