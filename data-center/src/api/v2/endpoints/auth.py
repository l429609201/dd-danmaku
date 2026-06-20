"""
v2 认证端点：登录 / 登出 / 当前用户 / 初始化状态
"""
import hashlib
import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from src.database import get_db_sync
from src.models_v2 import LocalUser
from src.services_v2.auth_service import auth_service_v2
from src.services_v2.runtime_event_service import runtime_event_service
from src.api.v2.deps import get_current_user
from src.api.v2.schemas import ChangePasswordRequest, LoginRequest, ApiResult

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


@router.post("/change-password", response_model=ApiResult)
async def change_password(
    body: ChangePasswordRequest,
    current_user: LocalUser = Depends(get_current_user),
):
    """修改当前用户密码：校验旧密码后更新，避免误改他人账号"""
    old_password = (body.old_password or "").strip()
    new_password = (body.new_password or "").strip()
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="新密码长度至少 8 位")
    if old_password == new_password:
        raise HTTPException(status_code=400, detail="新密码不能与旧密码相同")

    db = get_db_sync()
    try:
        user = db.query(LocalUser).filter(LocalUser.id == current_user.id).first()
        if not user or not user.is_active:
            raise HTTPException(status_code=404, detail="用户不存在或已停用")
        if not user.verify_password(old_password):
            raise HTTPException(status_code=400, detail="旧密码错误")

        user.set_password(new_password)
        db.commit()
        runtime_event_service.log(
            "INFO", "auth", "password_changed",
            f"用户 {user.username} 修改了密码",
            {"user_id": user.id, "username": user.username},
        )
        return ApiResult(message="密码修改成功，请使用新密码重新登录")
    finally:
        db.close()


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
