"""
外部控制 API 独立密钥服务。

用途：为 MCP / 外部诊断工具提供一个**独立于用户登录**的访问密钥，
统一鉴权所有 /api/v2/ext/* 外部控制接口。

密钥来源优先级：
1. AppSetting("external_control_token")（管理后台可配、可轮换）
2. settings.EXTERNAL_CONTROL_TOKEN（环境变量兜底）

首次无密钥时自动生成一个并存入 AppSetting，日志打印一次（便于初始化）。
比对采用常量时间比较，防时序侧信道。
"""
import logging
import secrets

from src.database import get_db_sync
from src.models_v2 import AppSetting
from src.config import settings

logger = logging.getLogger(__name__)

_SETTING_KEY = "external_control_token"


class ExternalControlAuth:
    """外部控制密钥的读取/生成/校验"""

    def _read_setting(self) -> str:
        db = get_db_sync()
        try:
            row = db.query(AppSetting).filter(AppSetting.key == _SETTING_KEY).first()
            return (row.value or "").strip() if row else ""
        finally:
            db.close()

    def _write_setting(self, value: str):
        db = get_db_sync()
        try:
            row = db.query(AppSetting).filter(AppSetting.key == _SETTING_KEY).first()
            if row:
                row.value = value
            else:
                db.add(AppSetting(
                    key=_SETTING_KEY, value=value, value_type="secret",
                    description="外部控制 API 独立密钥（MCP/诊断）", is_secret=True,
                ))
            db.commit()
        finally:
            db.close()

    def get_token(self) -> str:
        """取当前有效密钥：AppSetting 优先，env 兜底；都无则自动生成并落库"""
        token = self._read_setting()
        if token:
            return token
        if settings.EXTERNAL_CONTROL_TOKEN:
            return settings.EXTERNAL_CONTROL_TOKEN.strip()
        # 都没有：生成一个并落库，打印一次便于初始化接入
        generated = secrets.token_urlsafe(32)
        try:
            self._write_setting(generated)
            logger.warning(f"🔑 已自动生成外部控制 API 密钥（请妥善保存）: {generated}")
        except Exception as e:
            logger.error(f"❌ 外部控制密钥落库失败: {e}")
        return generated

    def rotate(self) -> str:
        """轮换密钥：生成新值并落库，返回明文"""
        new_token = secrets.token_urlsafe(32)
        self._write_setting(new_token)
        logger.warning("🔑 外部控制 API 密钥已轮换")
        return new_token

    def verify(self, provided: str) -> bool:
        """常量时间比较校验"""
        if not provided:
            return False
        expected = self.get_token()
        if not expected:
            return False
        return secrets.compare_digest(provided.strip(), expected)


external_control_auth = ExternalControlAuth()
