"""
JWT令牌工具模块
"""
from jose import jwt, JWTError
import secrets
from datetime import timedelta, datetime
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
        
        # 使用本地时间但转换为timestamp（确保兼容性）
        now = naive_now()
        if expires_delta:
            expire = now + expires_delta
        else:
            expire = now + timedelta(days=3)  # 默认3天

        exp_timestamp = int(expire.timestamp())
        iat_timestamp = int(now.timestamp())

        logger.info(f"🔐 JWT时间信息: now={now}, expire={expire}")
        logger.info(f"🔐 JWT时间戳: iat={iat_timestamp}, exp={exp_timestamp}")

        to_encode.update({
            "exp": exp_timestamp,  # 转换为timestamp确保兼容性
            "iat": iat_timestamp,  # 转换为timestamp确保兼容性
            "type": "access"
        })
        
        try:
            logger.info(f"🔐 准备编码JWT数据: {to_encode}")
            encoded_jwt = jwt.encode(to_encode, self.secret_key, algorithm=self.algorithm)
            logger.info(f"✅ JWT令牌创建成功，过期时间: {expire} (本地时间)")
            logger.info(f"✅ 生成的JWT令牌: {encoded_jwt[:50]}...")
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
        except JWTError as e:
            # python-jose的JWTError包含了所有JWT相关错误
            error_msg = str(e)
            logger.error(f"❌ JWT验证失败详情: {error_msg}")
            logger.error(f"❌ 令牌内容: {token[:50]}...")
            logger.error(f"❌ 使用的密钥: {self.secret_key[:10]}...")

            if "expired" in error_msg.lower():
                logger.warning(f"⚠️ JWT令牌已过期: {token[:20]}...")
            elif "signature" in error_msg.lower():
                logger.warning(f"⚠️ JWT令牌签名无效: {token[:20]}...")
            else:
                logger.warning(f"⚠️ JWT令牌格式无效: {error_msg}, token: {token[:20]}...")
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
        except JWTError as e:
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
            # expiry现在是timestamp，直接比较
            current_timestamp = naive_now().timestamp()
            logger.info(f"🔐 过期检查: current={current_timestamp}, expiry={expiry}")
            is_expired = current_timestamp > expiry
            logger.info(f"🔐 令牌过期状态: {is_expired}")
            return is_expired
        logger.warning("🔐 无法获取令牌过期时间，视为已过期")
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

def test_jwt_functionality():
    """测试JWT功能"""
    logger.info("🧪 开始JWT功能自测试...")

    # 创建测试数据
    test_data = {
        "user_id": 1,
        "username": "test_user",
        "sub": "1"
    }

    # 创建JWT令牌
    token = create_access_token(test_data, timedelta(minutes=30))
    logger.info(f"🧪 创建测试令牌: {token[:50]}...")

    # 验证JWT令牌
    payload = verify_token(token)
    if payload:
        logger.info(f"✅ JWT自测试成功: {payload}")
        return True
    else:
        logger.error("❌ JWT自测试失败")
        return False
