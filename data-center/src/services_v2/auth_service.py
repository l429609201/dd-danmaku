"""
认证服务 v2（LocalUser / LocalLoginSession）

复用 src.utils.jwt_utils 生成/校验 JWT；
会话以 JWT 的 sha256 hash 落库（session_token_hash），避免明文。
"""
import logging
from datetime import timedelta
from typing import Optional

from src.database import get_db_sync
from src.models_v2 import LocalUser, LocalLoginSession
from src.utils import create_access_token, naive_now
from src.utils.jwt_utils import jwt_utils

logger = logging.getLogger(__name__)

# 角色权限等级：数字越大权限越高
ROLE_LEVEL = {"viewer": 1, "operator": 2, "admin": 3}


class AuthServiceV2:
    """用户认证服务 v2"""

    async def authenticate(self, username: str, password: str) -> Optional[LocalUser]:
        """校验用户名密码"""
        db = get_db_sync()
        try:
            user = db.query(LocalUser).filter(
                LocalUser.username == username,
                LocalUser.is_active == True,  # noqa: E712
            ).first()
            if user and user.verify_password(password):
                user.last_login_at = naive_now()
                db.commit()
                # 返回脱离会话的轻量对象
                detached = LocalUser(
                    id=user.id, username=user.username,
                    display_name=user.display_name, role=user.role,
                    is_active=user.is_active, is_superuser=user.is_superuser,
                )
                return detached
            return None
        except Exception as e:
            logger.error(f"❌ 用户认证失败: {e}")
            return None
        finally:
            db.close()

    async def create_session(self, user: LocalUser,
                             expires_hours: int = 24,
                             ip_hash: Optional[str] = None,
                             user_agent: Optional[str] = None) -> str:
        """创建登录会话并返回 JWT"""
        token = create_access_token(
            {"user_id": user.id, "username": user.username,
             "role": user.role, "sub": str(user.id)},
            timedelta(hours=expires_hours),
        )
        db = get_db_sync()
        try:
            session = LocalLoginSession(
                user_id=user.id,
                session_token_hash=LocalLoginSession.hash_token(token),
                expires_at=naive_now() + timedelta(hours=expires_hours),
                ip_hash=ip_hash,
                user_agent=(user_agent or "")[:500],
                is_active=True,
            )
            db.add(session)
            db.commit()
            return token
        finally:
            db.close()

    async def validate_jwt(self, token: str) -> Optional[LocalUser]:
        """校验 JWT + 会话有效性，返回用户"""
        payload = jwt_utils.verify_token(token)
        if not payload:
            return None
        token_hash = LocalLoginSession.hash_token(token)
        db = get_db_sync()
        try:
            session = db.query(LocalLoginSession).filter(
                LocalLoginSession.session_token_hash == token_hash,
                LocalLoginSession.is_active == True,  # noqa: E712
                LocalLoginSession.expires_at > naive_now(),
            ).first()
            if not session:
                return None
            user = db.query(LocalUser).filter(
                LocalUser.id == session.user_id,
                LocalUser.is_active == True,  # noqa: E712
            ).first()
            if not user:
                return None
            return LocalUser(
                id=user.id, username=user.username,
                display_name=user.display_name, role=user.role,
                is_active=user.is_active, is_superuser=user.is_superuser,
            )
        finally:
            db.close()

    async def revoke(self, token: str) -> bool:
        """吊销会话"""
        token_hash = LocalLoginSession.hash_token(token)
        db = get_db_sync()
        try:
            session = db.query(LocalLoginSession).filter(
                LocalLoginSession.session_token_hash == token_hash,
                LocalLoginSession.is_active == True,  # noqa: E712
            ).first()
            if session:
                session.is_active = False
                session.revoked_at = naive_now()
                db.commit()
                return True
            return False
        finally:
            db.close()


def has_role(user: LocalUser, required: str) -> bool:
    """判断用户角色是否达到要求等级"""
    return ROLE_LEVEL.get(user.role, 0) >= ROLE_LEVEL.get(required, 99)


auth_service_v2 = AuthServiceV2()
