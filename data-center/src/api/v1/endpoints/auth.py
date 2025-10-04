"""
用户认证API端点
"""
from typing import Dict, Any
from fastapi import APIRouter, HTTPException, Depends, Request, Response
from pydantic import BaseModel

from src.services.auth_service import AuthService
from src.models.auth import User

router = APIRouter()

# Pydantic模型
class LoginRequest(BaseModel):
    username: str
    password: str

class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str

class AuthResponse(BaseModel):
    success: bool
    message: str
    data: Any = None

# 依赖注入
def get_auth_service() -> AuthService:
    return AuthService()

async def get_current_user(request: Request, auth_service: AuthService = Depends(get_auth_service)) -> User:
    """获取当前登录用户"""
    # 从Cookie中获取会话令牌
    session_token = request.cookies.get("session_token")
    
    if not session_token:
        raise HTTPException(status_code=401, detail="未登录")
    
    user = await auth_service.validate_session(session_token)
    if not user:
        raise HTTPException(status_code=401, detail="会话已过期，请重新登录")
    
    return user

@router.post("/login", response_model=AuthResponse)
async def login(
    request: Request,
    response: Response,
    login_data: LoginRequest,
    auth_service: AuthService = Depends(get_auth_service)
):
    """用户登录"""
    try:
        # 验证用户
        user = await auth_service.authenticate_user(login_data.username, login_data.password)
        
        if not user:
            return AuthResponse(
                success=False,
                message="用户名或密码错误"
            )
        
        # 创建会话
        client_ip = request.client.host if request.client else None
        user_agent = request.headers.get("user-agent")
        
        session = await auth_service.create_session(
            user=user,
            ip_address=client_ip,
            user_agent=user_agent,
            expires_hours=24
        )
        
        # 设置Cookie
        response.set_cookie(
            key="session_token",
            value=session.session_token,
            max_age=24 * 60 * 60,  # 24小时
            httponly=True,
            secure=False,  # 开发环境设为False，生产环境应设为True
            samesite="lax"
        )
        
        return AuthResponse(
            success=True,
            message="登录成功",
            data={
                "user": user.to_dict(),
                "session_expires": session.expires_at.isoformat()
            }
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/logout", response_model=AuthResponse)
async def logout(
    request: Request,
    response: Response,
    auth_service: AuthService = Depends(get_auth_service)
):
    """用户登出"""
    try:
        session_token = request.cookies.get("session_token")
        
        if session_token:
            await auth_service.logout_session(session_token)
        
        # 清除Cookie
        response.delete_cookie(key="session_token")
        
        return AuthResponse(
            success=True,
            message="登出成功"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/me", response_model=Dict[str, Any])
async def get_current_user_info(
    current_user: User = Depends(get_current_user)
):
    """获取当前用户信息"""
    return current_user.to_dict()

@router.post("/change-password", response_model=AuthResponse)
async def change_password(
    password_data: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    auth_service: AuthService = Depends(get_auth_service)
):
    """修改密码"""
    try:
        success = await auth_service.change_password(
            user_id=current_user.id,
            old_password=password_data.old_password,
            new_password=password_data.new_password
        )
        
        if success:
            return AuthResponse(
                success=True,
                message="密码修改成功，请重新登录"
            )
        else:
            return AuthResponse(
                success=False,
                message="旧密码错误"
            )
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/sessions", response_model=list[Dict[str, Any]])
async def get_user_sessions(
    current_user: User = Depends(get_current_user),
    auth_service: AuthService = Depends(get_auth_service)
):
    """获取用户的活跃会话"""
    try:
        sessions = await auth_service.get_user_sessions(current_user.id)
        return [session.to_dict() for session in sessions]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/logout-all", response_model=AuthResponse)
async def logout_all_sessions(
    current_user: User = Depends(get_current_user),
    auth_service: AuthService = Depends(get_auth_service)
):
    """注销所有会话"""
    try:
        success = await auth_service.logout_all_sessions(current_user.id)
        
        if success:
            return AuthResponse(
                success=True,
                message="所有会话已注销"
            )
        else:
            return AuthResponse(
                success=False,
                message="注销失败"
            )
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/init-status", response_model=Dict[str, Any])
async def get_init_status(auth_service: AuthService = Depends(get_auth_service)):
    """获取初始化状态"""
    try:
        from src.database import get_db_sync
        from src.models.auth import User
        
        db = get_db_sync()
        admin_exists = db.query(User).filter(User.is_admin == True).first() is not None
        db.close()
        
        return {
            "admin_exists": admin_exists,
            "need_init": not admin_exists
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/init-admin", response_model=AuthResponse)
async def init_admin(auth_service: AuthService = Depends(get_auth_service)):
    """初始化管理员账户"""
    try:
        # 检查是否已存在管理员
        from src.database import get_db_sync
        from src.models.auth import User
        
        db = get_db_sync()
        admin_exists = db.query(User).filter(User.is_admin == True).first() is not None
        db.close()
        
        if admin_exists:
            return AuthResponse(
                success=False,
                message="管理员账户已存在"
            )
        
        # 创建管理员账户
        admin_user, password = await auth_service.create_admin_user()
        
        return AuthResponse(
            success=True,
            message="管理员账户创建成功",
            data={
                "username": admin_user.username,
                "password": password,
                "note": "请妥善保存密码，首次登录后建议立即修改"
            }
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
