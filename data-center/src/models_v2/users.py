"""
用户控制相关 ORM 模型

旧 users / login_sessions 全部废弃，统一重建为 local_* 命名空间：
- LocalUser           本地用户（admin/operator/viewer）
- LocalLoginSession   Web 登录会话
- LocalApiToken       开放 API Token（不复用 Web 登录 Session）
"""
import hashlib
import secrets

from sqlalchemy import (
    BigInteger, Boolean, Column, DateTime, ForeignKey, Integer, JSON, String,
)
from sqlalchemy.orm import relationship

from src.models_v2.base import Base, TimestampMixin


class LocalUser(Base, TimestampMixin):
    """本地用户表"""
    __tablename__ = "local_users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(80), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    display_name = Column(String(120), nullable=True)
    # 角色：admin / operator / viewer
    role = Column(String(30), default="viewer", index=True, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_superuser = Column(Boolean, default=False, nullable=False)
    last_login_at = Column(DateTime, nullable=True)
    last_login_ip_hash = Column(String(100), nullable=True)

    sessions = relationship(
        "LocalLoginSession", back_populates="user",
        cascade="all, delete-orphan",
    )
    api_tokens = relationship(
        "LocalApiToken", back_populates="user",
        cascade="all, delete-orphan",
    )

    def set_password(self, password: str):
        """设置密码：salt$sha256(password+salt)"""
        salt = secrets.token_hex(16)
        digest = hashlib.sha256(f"{password}{salt}".encode()).hexdigest()
        self.password_hash = f"{salt}${digest}"

    def verify_password(self, password: str) -> bool:
        """校验密码"""
        try:
            if not self.password_hash or "$" not in self.password_hash:
                return False
            salt, stored = self.password_hash.split("$", 1)
            digest = hashlib.sha256(f"{password}{salt}".encode()).hexdigest()
            return digest == stored
        except Exception:
            return False

    def to_dict(self):
        return {
            "id": self.id,
            "username": self.username,
            "display_name": self.display_name,
            "role": self.role,
            "is_active": self.is_active,
            "is_superuser": self.is_superuser,
            "last_login_at": self.last_login_at.isoformat() if self.last_login_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class LocalLoginSession(Base, TimestampMixin):
    """Web 登录会话表"""
    __tablename__ = "local_login_sessions"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("local_users.id"), index=True, nullable=False)
    # 存储 JWT 的 hash，避免明文落库
    session_token_hash = Column(String(128), unique=True, index=True, nullable=False)
    jwt_id = Column(String(100), index=True, nullable=True)
    ip_hash = Column(String(100), nullable=True)
    user_agent = Column(String(500), nullable=True)
    expires_at = Column(DateTime, index=True, nullable=False)
    revoked_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    user = relationship("LocalUser", back_populates="sessions")

    @staticmethod
    def hash_token(token: str) -> str:
        """对 token 做 sha256，统一入库格式"""
        return hashlib.sha256(token.encode()).hexdigest()


class LocalApiToken(Base, TimestampMixin):
    """开放 API Token 表"""
    __tablename__ = "local_api_tokens"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("local_users.id"), index=True, nullable=False)
    name = Column(String(120), nullable=False)
    token_hash = Column(String(128), unique=True, index=True, nullable=False)
    # 权限范围，如 ["cache:read", "control:write"]
    scopes_json = Column(JSON, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    last_used_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, index=True, nullable=True)

    user = relationship("LocalUser", back_populates="api_tokens")

    @staticmethod
    def hash_token(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()
