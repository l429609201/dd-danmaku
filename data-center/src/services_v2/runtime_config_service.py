"""
运行配置组装与下发服务

统一从 DB 组装完整的 Worker runtime 配置（IP 黑白名单 + UA 限流），
通过长连接 config.apply 一次性下发，避免分散下发互相覆盖。
"""
import logging
from typing import Any, Dict

from sqlalchemy import or_

from src.database import get_db_sync
from src.models_v2 import IpRule, UaLimitRule
from src.models_v2.base import now
from src.services_v2.control_client import control_client

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
            # 过期规则在 SQL 层就过滤掉：自动封禁会持续写入 ip_rules，
            # 过期记录若不清理会累积到数万行，全部 load 进内存再逐条跳过
            # 会让每次下发都退化成全表扫描（实测 7 万行时单次查询 2.4 秒，
            # 而下发由 abuse 上报触发、5~15 秒一次，直接拖高事件循环延迟）。
            # 只取需要的列，避免回表读 reason/created_at 等无关字段。
            ip_rows = db.query(
                IpRule.ip_or_cidr, IpRule.rule_type, IpRule.reason,
            ).filter(
                IpRule.enabled == True,  # noqa: E712
                or_(IpRule.expires_at.is_(None), IpRule.expires_at > current),
            ).all()
            for r in ip_rows:
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
                # 签名校验：下发绑定的签名组 signGroupId，Worker 据此决定是否强制验签。
                # 注意：Worker(cf_worker.js) 判断的是 uaConfig.signGroupId，
                #       此前仅下发已废弃的 signRequired，导致验签分支永不进入。
                _sign_grp = getattr(u, "sign_group_id", None)
                if _sign_grp:
                    cfg["signGroupId"] = _sign_grp
                # 兼容保留：旧字段 signRequired（Worker 已不读，仅用于向后可观测）
                if getattr(u, "sign_required", False):
                    cfg["signRequired"] = True
                # 用户名过滤：绑定的用户允许名单组（空=不校验用户名）
                _user_grp = getattr(u, "user_group_id", None)
                if _user_grp:
                    cfg["userGroupId"] = _user_grp
                # 实例 ID 校验：品牌标记 + 混淆密钥（两者都配才启用）
                # 实例校验参数已移入 user_allow_pool 组（brandMark/obfKey），Worker 按 userGroupId 查组取值
                ua_configs[u.ua_key] = cfg

            # 密钥池：本地端启用的密钥列表，下发给 Worker 合并
            from src.services_v2.key_pool_service import key_pool_service
            key_pool = key_pool_service.build_pool_payload()

            # 客户端签名密钥池：按 UA 分组，与对应 wasm 内置值一致，走长连接(TLS)下发给 Worker 验签
            from src.services_v2.sign_key_pool_service import sign_key_pool_service
            sign_key_pool = sign_key_pool_service.build_pool_payload()

            # 用户允许名单池：UA 规则通过 userGroupId 绑定，Worker 据此过滤 X-Ddd-User
            from src.services_v2.user_allow_pool_service import user_allow_pool_service
            user_allow_pool = user_allow_pool_service.build_pool_payload()

            payload = {
                "ip_blacklist": blacklist,
                "ip_whitelist": whitelist,
                "ua_configs": ua_configs,
                "key_pool": key_pool,
                "sign_key_pool": sign_key_pool,
                "user_allow_pool": user_allow_pool,
            }

            # OAuth 配置：结构与 Worker 侧 env.OAUTH_CONFIG 一致。
            # 关键：仅在本地端有生效记录时才放入 payload。
            # 因为 Worker 的 applyRuntimeConfig 用「'oauth_config' in cfg」判断，
            # 字段缺失=本地端未表态（保持 env 兜底），字段存在=按下发值覆盖。
            # 若无条件下发 None/{}，会把未配置误当成「显式禁用」，导致
            # 已在 CF 环境变量里配好 OAuth 的用户升级后登录直接失效。
            from src.services_v2.oauth_config_service import oauth_config_service
            oauth_cfg = oauth_config_service.build_payload()
            if oauth_cfg is not None:
                payload["oauth_config"] = oauth_cfg

            return payload
        finally:
            db.close()

    async def push_to_worker(self) -> bool:
        """组装完整配置并通过长连接下发"""
        payload = self.build_full_payload()
        result = await control_client.request("config.apply", payload)
        return bool(result and result.get("success"))


runtime_config_service = RuntimeConfigService()
