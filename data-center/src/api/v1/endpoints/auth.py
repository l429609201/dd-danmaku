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
    current_password: str
    new_password: str
    confirm_password: str

class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str

class AuthResponse(BaseModel):
    success: bool
    message: str
    data: Any = None

class LoginResponse(BaseModel):
    success: bool
    message: str
    access_token: str
    token_type: str
    expires_in: int
    user: dict

# 依赖注入
def get_auth_service() -> AuthService:
    return AuthService()

async def get_current_user(
    authorization: Optional[str] = Header(None, alias="authorization"),
    auth_service: AuthService = Depends(get_auth_service)
) -> User:
    """获取当前用户（JWT认证）"""
    import logging
    logger = logging.getLogger(__name__)

    logger.info(f"🔐 收到认证请求")
    logger.info(f"🔐 Authorization头内容: {authorization}")
    logger.info(f"🔐 Authorization头类型: {type(authorization)}")
    logger.info(f"🔐 Authorization头长度: {len(authorization) if authorization else 0}")

    if not authorization:
        logger.warning("🔐 认证失败: 未提供认证令牌")
        raise HTTPException(status_code=401, detail="未提供认证令牌")

    # 检查Bearer格式
    if not authorization.startswith("Bearer "):
        logger.warning(f"🔐 认证失败: 令牌格式错误 - {authorization[:20]}...")
        raise HTTPException(status_code=401, detail="认证令牌格式错误")

    token = authorization.split(" ")[1]
    logger.info(f"🔐 正在验证JWT令牌: {token[:20]}...")

    # 首先验证JWT令牌格式和签名
    payload = verify_token(token)
    if not payload:
        logger.warning(f"🔐 认证失败: JWT令牌格式无效或签名错误 - {token[:20]}...")
        raise HTTPException(status_code=401, detail="令牌无效或已过期")

    logger.info(f"🔐 JWT令牌格式验证成功: {payload}")

    # 从数据库验证会话
    user = await auth_service.validate_jwt_session(token)
    if not user:
        logger.warning(f"🔐 认证失败: 会话不存在或已过期 - {token[:20]}...")
        raise HTTPException(status_code=401, detail="会话无效或已过期")

    logger.info(f"🔐 用户认证成功: {user.username}")
    return user

@router.post("/change-password", response_model=AuthResponse)
async def change_password(
    password_data: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    auth_service: AuthService = Depends(get_auth_service)
):
    """修改密码"""
    try:
        # 验证新密码确认
        if password_data.new_password != password_data.confirm_password:
            raise HTTPException(status_code=400, detail="新密码与确认密码不匹配")

        # 验证新密码强度
        if len(password_data.new_password) < 6:
            raise HTTPException(status_code=400, detail="新密码长度至少6位")

        # 使用带验证的修改密码方法
        success = await auth_service.change_password(
            user_id=current_user.id,
            old_password=password_data.current_password,
            new_password=password_data.new_password
        )

        if success:
            return AuthResponse(
                success=True,
                message="密码修改成功"
            )
        else:
            raise HTTPException(status_code=400, detail="当前密码错误")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/login", response_model=LoginResponse)
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
            raise HTTPException(status_code=401, detail="用户名或密码错误")
        
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

        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"🔐 为用户 {user.username} 生成JWT令牌: {access_token[:20]}...")

        # 立即测试JWT令牌是否可以验证
        from src.utils import verify_token
        test_payload = verify_token(access_token)
        if test_payload:
            logger.info(f"✅ JWT令牌创建后立即验证成功: {test_payload}")
        else:
            logger.error(f"❌ JWT令牌创建后立即验证失败！")

        # 记录登录信息（可选，用于审计）
        client_ip = request.client.host if request.client else None
        user_agent = request.headers.get("user-agent")

        # 创建会话并存储JWT令牌
        session = await auth_service.create_session(
            user=user,
            jwt_token=access_token,
            ip_address=client_ip,
            user_agent=user_agent,
            expires_hours=72  # 3天
        )

        logger.info(f"🔐 会话创建成功: session_id={session.id}")

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
    authorization: Optional[str] = Header(None),
    current_user: User = Depends(get_current_user),
    auth_service: AuthService = Depends(get_auth_service)
):
    """用户登出（撤销JWT令牌）"""
    try:
        if authorization and authorization.startswith("Bearer "):
            token = authorization.split(" ")[1]

            # 撤销会话
            success = await auth_service.revoke_jwt_session(token)
            if success:
                return AuthResponse(
                    success=True,
                    message="登出成功"
                )

        return AuthResponse(
            success=True,
            message="登出成功"
        )
    except Exception as e:
        return AuthResponse(
            success=True,
            message="登出成功"  # 即使撤销失败也返回成功，因为前端会清除令牌
        )

@router.get("/me", response_model=Dict[str, Any])
async def get_current_user_info(
    request: Request,
    auth_service: AuthService = Depends(get_auth_service)
):
    """获取当前用户信息"""
    import logging
    logger = logging.getLogger(__name__)

    logger.info(f"🔐 /me端点被调用")
    logger.info(f"🔐 请求头: {dict(request.headers)}")

    # 直接在这里处理认证
    authorization = request.headers.get('authorization')
    logger.info(f"🔐 Authorization头: {authorization}")

    if not authorization:
        logger.warning("🔐 认证失败: 未提供认证令牌")
        raise HTTPException(status_code=401, detail="未提供认证令牌")

    # 检查Bearer格式
    if not authorization.startswith("Bearer "):
        logger.warning(f"🔐 认证失败: 令牌格式错误 - {authorization[:20]}...")
        raise HTTPException(status_code=401, detail="认证令牌格式错误")

    token = authorization.split(" ")[1]
    logger.info(f"🔐 正在验证JWT令牌: {token[:20]}...")

    # 首先验证JWT令牌格式和签名
    payload = verify_token(token)
    if not payload:
        logger.warning(f"🔐 认证失败: JWT令牌格式无效或签名错误 - {token[:20]}...")
        raise HTTPException(status_code=401, detail="令牌无效或已过期")

    logger.info(f"🔐 JWT令牌格式验证成功: {payload}")

    # 从数据库验证会话
    user = await auth_service.validate_jwt_session(token)
    if not user:
        logger.warning(f"🔐 认证失败: 会话不存在或已过期 - {token[:20]}...")
        raise HTTPException(status_code=401, detail="会话无效或已过期")

    logger.info(f"🔐 用户认证成功: {user.username}")
    return user.to_dict()



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
