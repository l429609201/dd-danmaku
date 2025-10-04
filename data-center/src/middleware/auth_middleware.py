"""
认证中间件
"""
from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from src.services.auth_service import AuthService

class AuthMiddleware(BaseHTTPMiddleware):
    """认证中间件"""
    
    def __init__(self, app):
        super().__init__(app)
        self.auth_service = AuthService()
        
        # 不需要认证的路径
        self.public_paths = {
            "/",
            "/health",
            "/docs",
            "/openapi.json",
            "/redoc",
            "/api/v1/auth/login",
            "/api/v1/auth/init-status",
            "/api/v1/auth/init-admin"
        }
        
        # 静态文件路径
        self.static_prefixes = [
            "/static/",
            "/assets/",
            "/favicon.ico"
        ]
    
    async def dispatch(self, request: Request, call_next):
        """处理请求"""
        path = request.url.path
        
        # 检查是否为公开路径
        if self._is_public_path(path):
            return await call_next(request)
        
        # 检查是否为静态文件
        if self._is_static_path(path):
            return await call_next(request)
        
        # 验证会话
        session_token = request.cookies.get("session_token")
        
        if not session_token:
            return self._unauthorized_response("未登录")
        
        user = await self.auth_service.validate_session(session_token)
        if not user:
            return self._unauthorized_response("会话已过期，请重新登录")
        
        # 将用户信息添加到请求状态
        request.state.current_user = user
        
        return await call_next(request)
    
    def _is_public_path(self, path: str) -> bool:
        """检查是否为公开路径"""
        return path in self.public_paths
    
    def _is_static_path(self, path: str) -> bool:
        """检查是否为静态文件路径"""
        return any(path.startswith(prefix) for prefix in self.static_prefixes)
    
    def _unauthorized_response(self, message: str) -> JSONResponse:
        """返回未授权响应"""
        return JSONResponse(
            status_code=401,
            content={
                "success": False,
                "message": message,
                "error_code": "UNAUTHORIZED"
            }
        )
