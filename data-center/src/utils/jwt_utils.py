"""
JWT令牌工具模块
"""
import jwt
import secrets
from datetime import timedelta
from typing import Optional, Dict, Any
import logging

from src.utils.time_utils import naive_now
from src.config import settings

logger = logging.getLogger(__name__)

class JWTUtils:
    """JWT令牌工具类"""
    
    def __init__(self, secret_key: Optional[str] = None, algorithm: str = "HS256"):
        """
        初始化JWT工具
        
        Args:
            secret_key: JWT签名密钥，如果不提供则自动生成
            algorithm: 签名算法
        """
        self.secret_key = secret_key or self._generate_secret_key()
        self.algorithm = algorithm
        logger.info(f"🔐 JWT工具初始化完成，算法: {algorithm}")
    
    def _generate_secret_key(self) -> str:
        """生成随机密钥"""
        return secrets.token_urlsafe(32)
    
    def create_access_token(self, data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
        """
        创建访问令牌
        
        Args:
            data: 要编码的数据
            expires_delta: 过期时间间隔，默认3天
            
        Returns:
            JWT令牌字符串
        """
        to_encode = data.copy()
        
        if expires_delta:
            expire = naive_now() + expires_delta
        else:
            expire = naive_now() + timedelta(days=3)  # 默认3天

        to_encode.update({
            "exp": expire,
            "iat": naive_now(),
            "type": "access"
        })
        
        try:
            encoded_jwt = jwt.encode(to_encode, self.secret_key, algorithm=self.algorithm)
            logger.info(f"✅ JWT令牌创建成功，过期时间: {expire}")
            return encoded_jwt
        except Exception as e:
            logger.error(f"❌ JWT令牌创建失败: {e}")
            raise
    
    def verify_token(self, token: str) -> Optional[Dict[str, Any]]:
        """
        验证令牌

        Args:
            token: JWT令牌字符串

        Returns:
            解码后的数据，如果验证失败返回None
        """
        try:
            logger.info(f"🔐 开始验证JWT令牌: {token[:20]}...")
            logger.info(f"🔐 使用密钥: {self.secret_key[:10]}...")

            payload = jwt.decode(token, self.secret_key, algorithms=[self.algorithm])
            logger.info(f"🔐 JWT解码成功: {payload}")

            # 检查令牌类型
            if payload.get("type") != "access":
                logger.warning("⚠️ 令牌类型不正确")
                return None

            logger.info("✅ JWT令牌验证成功")
            return payload
        except jwt.ExpiredSignatureError:
            logger.warning(f"⚠️ JWT令牌已过期: {token[:20]}...")
            return None
        except jwt.InvalidTokenError as e:
            logger.warning(f"⚠️ JWT令牌无效: {e}, token: {token[:20]}...")
            return None
        except Exception as e:
            logger.error(f"❌ JWT令牌验证失败: {e}, token: {token[:20]}...")
            return None
    
    def decode_token_without_verification(self, token: str) -> Optional[Dict[str, Any]]:
        """
        不验证签名解码令牌（用于调试）
        
        Args:
            token: JWT令牌字符串
            
        Returns:
            解码后的数据
        """
        try:
            return jwt.decode(token, options={"verify_signature": False})
        except Exception as e:
            logger.error(f"❌ JWT令牌解码失败: {e}")
            return None
    
    def get_token_expiry(self, token: str) -> Optional[int]:
        """
        获取令牌过期时间戳
        
        Args:
            token: JWT令牌字符串
            
        Returns:
            过期时间戳，如果获取失败返回None
        """
        payload = self.decode_token_without_verification(token)
        if payload:
            return payload.get("exp")
        return None
    
    def is_token_expired(self, token: str) -> bool:
        """
        检查令牌是否过期
        
        Args:
            token: JWT令牌字符串
            
        Returns:
            是否过期
        """
        expiry = self.get_token_expiry(token)
        if expiry:
            return naive_now().timestamp() > expiry
        return True
    
    def refresh_token(self, token: str, expires_delta: Optional[timedelta] = None) -> Optional[str]:
        """
        刷新令牌
        
        Args:
            token: 原始令牌
            expires_delta: 新的过期时间间隔
            
        Returns:
            新的令牌，如果刷新失败返回None
        """
        payload = self.verify_token(token)
        if not payload:
            return None
        
        # 移除时间相关字段
        payload.pop("exp", None)
        payload.pop("iat", None)
        
        return self.create_access_token(payload, expires_delta)


# 全局JWT工具实例（使用配置中的密钥）
jwt_utils = JWTUtils(secret_key=settings.SECRET_KEY)

# 便捷函数
def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """创建访问令牌"""
    return jwt_utils.create_access_token(data, expires_delta)

def verify_token(token: str) -> Optional[Dict[str, Any]]:
    """验证令牌"""
    return jwt_utils.verify_token(token)

def is_token_expired(token: str) -> bool:
    """检查令牌是否过期"""
    return jwt_utils.is_token_expired(token)

def refresh_token(token: str, expires_delta: Optional[timedelta] = None) -> Optional[str]:
    """刷新令牌"""
    return jwt_utils.refresh_token(token, expires_delta)
