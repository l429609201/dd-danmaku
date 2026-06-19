"""
v2 认证端点：登录 / 登出 / 当前用户 / 初始化状态
"""
import hashlib
import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from src.database import get_db_sync
from src.models_v2 import LocalUser
from src.services_v2.auth_service import auth_service_v2
from src.api.v2.deps import get_current_user
from src.api.v2.schemas import LoginRequest, ApiResult

logger = logging.getLogger(__name__)
router = APIRouter()


def _ip_hash(request: Request) -> str:
    """对客户端 IP 做 hash，避免直接落库明文 IP"""
    ip = request.client.host if request.client else "unknown"
    return hashlib.sha256(ip.encode()).hexdigest()[:32]


@router.post("/login", response_model=ApiResult)
async def login(body: LoginRequest, request: Request):
    """用户登录，返回 JWT"""
    user = await auth_service_v2.authenticate(body.username, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    token = await auth_service_v2.create_session(
        user,
        ip_hash=_ip_hash(request),
        user_agent=request.headers.get("user-agent"),
    )
    return ApiResult(data={
        "access_token": token,
        "token_type": "bearer",
        "user": user.to_dict(),
    })


@router.post("/logout", response_model=ApiResult)
async def logout(request: Request, current_user: LocalUser = Depends(get_current_user)):
    """登出，吊销当前会话"""
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        await auth_service_v2.revoke(auth.split(" ", 1)[1])
    return ApiResult(message="已登出")


@router.get("/me", response_model=ApiResult)
async def me(current_user: LocalUser = Depends(get_current_user)):
    """获取当前登录用户信息"""
    return ApiResult(data=current_user.to_dict())


@router.get("/init-status", response_model=ApiResult)
async def init_status():
    """初始化状态：是否已存在 admin"""
    db = get_db_sync()
    try:
        admin_exists = db.query(LocalUser).filter(
            LocalUser.role == "admin"
        ).first() is not None
        return ApiResult(data={
            "admin_exists": admin_exists,
            "need_init": not admin_exists,
        })
    finally:
        db.close()
