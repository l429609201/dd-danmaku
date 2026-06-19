"""
API v2 依赖注入：JWT 认证 + 角色权限校验

通过 Authorization: Bearer <token> 解析当前用户。
角色等级：viewer < operator < admin。
"""
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
    user = await auth_service_v2.validate_jwt(token)
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
