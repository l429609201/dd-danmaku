"""
用户认证API端点
"""
from typing import Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Depends, Request, Response, Header
from pydantic import BaseModel
from datetime import timedelta

from src.services.auth_service import AuthService
from src.models.auth import User
from src.utils import create_access_token, verify_token

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

async def get_current_user(
    authorization: Optional[str] = Header(None),
    auth_service: AuthService = Depends(get_auth_service)
) -> User:
    """获取当前用户（JWT认证）"""
    if not authorization:
        raise HTTPException(status_code=401, detail="未提供认证令牌")

    # 检查Bearer格式
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="认证令牌格式错误")

    token = authorization.split(" ")[1]

    # 验证JWT令牌
    payload = verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="令牌无效或已过期")

    # 获取用户信息
    user_id = payload.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="令牌数据无效")

    user = await auth_service.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")

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
        
        # 创建JWT令牌
        token_data = {
            "user_id": user.id,
            "username": user.username,
            "sub": str(user.id)  # JWT标准字段
        }

        # 创建访问令牌，有效期3天
        access_token = create_access_token(
            data=token_data,
            expires_delta=timedelta(days=3)
        )

        # 记录登录信息（可选，用于审计）
        client_ip = request.client.host if request.client else None
        user_agent = request.headers.get("user-agent")

        return {
            "success": True,
            "message": "登录成功",
            "access_token": access_token,
            "token_type": "bearer",
            "expires_in": 3 * 24 * 60 * 60,  # 3天，单位秒
            "user": user.to_dict()
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/logout")
async def logout(
    current_user: User = Depends(get_current_user)
):
    """用户登出（JWT令牌无需服务端处理）"""
    return {
        "success": True,
        "message": "登出成功"
    }

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
