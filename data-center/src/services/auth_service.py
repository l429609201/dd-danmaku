"""
用户认证服务
"""
import logging
import secrets
from datetime import timedelta
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from src.database import get_db_sync
from src.models.auth import User, LoginSession
from src.utils import now, utc_now

logger = logging.getLogger(__name__)

class AuthService:
    """用户认证服务"""
    
    def __init__(self):
        self.db = get_db_sync
    
    async def create_admin_user(self, username: str = None, password: str = None) -> tuple[User, str]:
        """创建管理员用户"""
        try:
            db = self.db()

            # 从环境变量获取用户名，默认为admin
            if not username:
                import os
                username = os.getenv('ADMIN_USERNAME', 'admin')

            # 检查是否已存在该用户名的管理员
            existing_admin = db.query(User).filter(User.username == username).first()
            if existing_admin:
                db.close()
                logger.info(f"👤 用户 '{username}' 已经存在，跳过创建过程")
                return existing_admin, None

            # 生成随机密码（如果未提供）
            if not password:
                password = self.generate_random_password()

            # 创建管理员用户
            admin_user = User(
                username=username,
                is_active=True,
                is_admin=True
            )
            admin_user.set_password(password)

            db.add(admin_user)
            db.commit()
            db.refresh(admin_user)
            db.close()

            logger.info(f"✅ 管理员用户 '{username}' 创建成功")
            logger.info(f"🔑 初始密码: {password}")
            return admin_user, password
            
        except Exception as e:
            logger.error(f"创建管理员用户失败: {e}")
            raise
    
    def generate_random_password(self, length: int = 12) -> str:
        """生成随机密码"""
        # 包含大小写字母、数字和特殊字符
        import string
        characters = string.ascii_letters + string.digits + "!@#$%^&*"
        password = ''.join(secrets.choice(characters) for _ in range(length))
        return password
    
    async def authenticate_user(self, username: str, password: str) -> Optional[User]:
        """验证用户登录"""
        try:
            db = self.db()

            user = db.query(User).filter(
                User.username == username,
                User.is_active == True
            ).first()

            if user and user.verify_password(password):
                # 更新最后登录时间
                user.last_login = now()
                db.commit()

                # 创建一个分离的用户对象，避免会话问题
                user_data = User(
                    id=user.id,
                    username=user.username,
                    password_hash=user.password_hash,
                    is_active=user.is_active,
                    created_at=user.created_at,
                    last_login=user.last_login
                )

                db.close()

                logger.info(f"✅ 用户登录成功: {username}")
                return user_data

            db.close()
            logger.warning(f"⚠️ 用户登录失败: {username}")
            return None

        except Exception as e:
            logger.error(f"用户认证失败: {e}")
            return None
    
    async def create_session(self, user: User, ip_address: str = None,
                           user_agent: str = None, expires_hours: int = 24) -> LoginSession:
        """创建登录会话"""
        try:
            db = self.db()

            # 清理过期会话
            await self.cleanup_expired_sessions(user.id)

            # 创建新会话
            session = LoginSession(
                user_id=user.id,
                session_token=LoginSession.generate_token(),
                expires_at=now() + timedelta(hours=expires_hours),
                ip_address=ip_address,
                user_agent=user_agent,
                is_active=True
            )

            db.add(session)
            db.commit()
            db.refresh(session)

            # 获取用户名用于日志记录
            username = user.username if hasattr(user, 'username') else str(user.id)

            db.close()

            logger.info(f"✅ 会话创建成功: 用户{username}")
            return session

        except Exception as e:
            logger.error(f"创建会话失败: {e}")
            raise
    
    async def validate_session(self, session_token: str) -> Optional[User]:
        """验证会话令牌"""
        try:
            db = self.db()
            
            session = db.query(LoginSession).filter(
                LoginSession.session_token == session_token,
                LoginSession.is_active == True,
                LoginSession.expires_at > now()
            ).first()
            
            if not session:
                db.close()
                return None
            
            # 获取用户信息
            user = db.query(User).filter(
                User.id == session.user_id,
                User.is_active == True
            ).first()
            
            db.close()
            return user
            
        except Exception as e:
            logger.error(f"验证会话失败: {e}")
            return None
    
    async def logout_session(self, session_token: str) -> bool:
        """注销会话"""
        try:
            db = self.db()
            
            session = db.query(LoginSession).filter(
                LoginSession.session_token == session_token
            ).first()
            
            if session:
                session.is_active = False
                db.commit()
                logger.info(f"✅ 会话注销成功")
                result = True
            else:
                logger.warning(f"⚠️ 会话不存在")
                result = False
            
            db.close()
            return result
            
        except Exception as e:
            logger.error(f"注销会话失败: {e}")
            return False
    
    async def cleanup_expired_sessions(self, user_id: int = None):
        """清理过期会话"""
        try:
            db = self.db()
            
            query = db.query(LoginSession).filter(
                LoginSession.expires_at < now()
            )
            
            if user_id:
                query = query.filter(LoginSession.user_id == user_id)
            
            expired_count = query.count()
            query.delete()
            db.commit()
            db.close()
            
            if expired_count > 0:
                logger.info(f"✅ 清理过期会话: {expired_count} 个")
            
        except Exception as e:
            logger.error(f"清理过期会话失败: {e}")
    
    async def change_password(self, user_id: int, old_password: str, new_password: str) -> bool:
        """修改密码"""
        try:
            db = self.db()
            
            user = db.query(User).filter(User.id == user_id).first()
            if not user:
                db.close()
                return False
            
            # 验证旧密码
            if not user.verify_password(old_password):
                db.close()
                logger.warning(f"⚠️ 旧密码验证失败: 用户{user.username}")
                return False
            
            # 设置新密码
            user.set_password(new_password)
            db.commit()
            db.close()
            
            # 清理该用户的所有会话（强制重新登录）
            await self.logout_all_sessions(user_id)
            
            logger.info(f"✅ 密码修改成功: 用户{user.username}")
            return True
            
        except Exception as e:
            logger.error(f"修改密码失败: {e}")
            return False
    
    async def logout_all_sessions(self, user_id: int) -> bool:
        """注销用户的所有会话"""
        try:
            db = self.db()
            
            sessions = db.query(LoginSession).filter(
                LoginSession.user_id == user_id,
                LoginSession.is_active == True
            ).all()
            
            for session in sessions:
                session.is_active = False
            
            db.commit()
            db.close()
            
            logger.info(f"✅ 注销所有会话成功: 用户ID{user_id}")
            return True
            
        except Exception as e:
            logger.error(f"注销所有会话失败: {e}")
            return False
    
    async def get_user_sessions(self, user_id: int) -> list[LoginSession]:
        """获取用户的活跃会话"""
        try:
            db = self.db()
            
            sessions = db.query(LoginSession).filter(
                LoginSession.user_id == user_id,
                LoginSession.is_active == True,
                LoginSession.expires_at > now()
            ).order_by(LoginSession.created_at.desc()).all()
            
            db.close()
            return sessions
            
        except Exception as e:
            logger.error(f"获取用户会话失败: {e}")
            return []

    async def get_user_by_id(self, user_id: int) -> Optional[User]:
        """根据用户ID获取用户"""
        try:
            db = self.db()

            user = db.query(User).filter(
                User.id == user_id,
                User.is_active == True
            ).first()

            db.close()
            return user

        except Exception as e:
            logger.error(f"获取用户失败: {e}")
            return None

    async def change_user_password(self, user_id: int, new_password: str) -> bool:
        """修改用户密码"""
        try:
            db = self.db()

            user = db.query(User).filter(
                User.id == user_id,
                User.is_active == True
            ).first()

            if not user:
                logger.error(f"用户不存在: {user_id}")
                db.close()
                return False

            # 更新密码
            user.set_password(new_password)
            user.updated_at = now()

            db.commit()
            db.close()

            logger.info(f"用户 {user.username} 密码修改成功")
            return True

        except Exception as e:
            logger.error(f"修改密码失败: {e}")
            if 'db' in locals():
                db.rollback()
                db.close()
            return False
