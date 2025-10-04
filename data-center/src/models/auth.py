"""
用户认证模型
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from sqlalchemy.sql import func
from src.database import Base
import hashlib
import secrets

class User(Base):
    """用户表"""
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    password_hash = Column(String(128), nullable=False)
    email = Column(String(100), nullable=True)
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=False)
    last_login = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    
    def set_password(self, password: str):
        """设置密码（哈希存储）"""
        # 生成盐值
        salt = secrets.token_hex(16)
        # 使用SHA256哈希密码+盐值
        password_with_salt = f"{password}{salt}"
        hash_object = hashlib.sha256(password_with_salt.encode())
        # 存储格式：盐值$哈希值
        self.password_hash = f"{salt}${hash_object.hexdigest()}"
    
    def verify_password(self, password: str) -> bool:
        """验证密码"""
        try:
            if not self.password_hash or '$' not in self.password_hash:
                return False
            
            salt, stored_hash = self.password_hash.split('$', 1)
            password_with_salt = f"{password}{salt}"
            hash_object = hashlib.sha256(password_with_salt.encode())
            return hash_object.hexdigest() == stored_hash
        except:
            return False
    
    def to_dict(self):
        """转换为字典"""
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            "is_active": self.is_active,
            "is_admin": self.is_admin,
            "last_login": self.last_login.isoformat() if self.last_login else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }

class LoginSession(Base):
    """登录会话表"""
    __tablename__ = "login_sessions"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False, index=True)
    session_token = Column(String(128), unique=True, index=True, nullable=False)
    jwt_token = Column(Text, nullable=True)  # 存储JWT令牌
    expires_at = Column(DateTime, nullable=False)
    ip_address = Column(String(45), nullable=True)  # 支持IPv6
    user_agent = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    
    @staticmethod
    def generate_token() -> str:
        """生成会话令牌"""
        return secrets.token_urlsafe(64)
    
    def to_dict(self):
        """转换为字典"""
        return {
            "id": self.id,
            "user_id": self.user_id,
            "session_token": self.session_token,
            "jwt_token": self.jwt_token,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "ip_address": self.ip_address,
            "user_agent": self.user_agent,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }
