"""
运行配置组装与下发服务

统一从 DB 组装完整的 Worker runtime 配置（IP 黑白名单 + UA 限流），
通过长连接 config.apply 一次性下发，避免分散下发互相覆盖。
"""
import logging
from typing import Any, Dict

from src.database import get_db_sync
from src.models_v2 import IpRule, UaLimitRule, AppSetting
from src.models_v2.base import now
from src.services_v2.control_client import control_client

# 签名校验密钥在 app_settings 中的 key
SIGN_SECRET_SETTING_KEY = "sign_secret"

logger = logging.getLogger(__name__)


class RuntimeConfigService:
    """组装并下发完整 Worker runtime 配置"""

    def build_full_payload(self) -> Dict[str, Any]:
        """从 DB 组装完整下发配置：ip_blacklist / ip_whitelist / ua_configs"""
        db = get_db_sync()
        try:
            current = now()
            blacklist: Dict[str, str] = {}
            whitelist: Dict[str, str] = {}
            for r in db.query(IpRule).filter(IpRule.enabled == True).all():  # noqa: E712
                if r.expires_at and current > r.expires_at:
                    continue
                if r.rule_type == "white":
                    whitelist[r.ip_or_cidr] = r.reason or ""
                else:
                    blacklist[r.ip_or_cidr] = r.reason or ""

            ua_configs: Dict[str, Any] = {}
            for u in db.query(UaLimitRule).filter(UaLimitRule.enabled == True).all():  # noqa: E712
                cfg = {
                    "type": u.ua_key,
                    "userAgent": u.user_agent or "",
                    "maxRequests": u.max_requests,
                    "windowMs": u.window_ms,
                    "pathLimits": u.path_limits_json or [],
                    "enabled": True,
                }
                # Worker 对象格式扩展字段（存在才下发，保持与导入格式一致）
                if u.max_requests_per_hour is not None:
                    cfg["maxRequestsPerHour"] = u.max_requests_per_hour
                if u.max_requests_per_day is not None:
                    cfg["maxRequestsPerDay"] = u.max_requests_per_day
                if u.description:
                    cfg["description"] = u.description
                # 签名校验开关：仅在开启时下发 signRequired=true，Worker 默认不校验（灰度安全）
                if getattr(u, "sign_required", False):
                    cfg["signRequired"] = True
                ua_configs[u.ua_key] = cfg

            # 密钥池：本地端启用的密钥列表，下发给 Worker 合并
            from src.services_v2.key_pool_service import key_pool_service
            key_pool = key_pool_service.build_pool_payload()

            # 客户端签名校验密钥：与 wasm 内置值一致，走长连接(TLS)下发给 Worker 验签
            sign_row = db.query(AppSetting).filter(
                AppSetting.key == SIGN_SECRET_SETTING_KEY).first()
            sign_secret = (sign_row.value or "") if sign_row else ""

            return {
                "ip_blacklist": blacklist,
                "ip_whitelist": whitelist,
                "ua_configs": ua_configs,
                "key_pool": key_pool,
                "sign_secret": sign_secret,
            }
        finally:
            db.close()

    async def push_to_worker(self) -> bool:
        """组装完整配置并通过长连接下发"""
        payload = self.build_full_payload()
        result = await control_client.request("config.apply", payload)
        return bool(result and result.get("success"))


runtime_config_service = RuntimeConfigService()
