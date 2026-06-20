"""
非法路由滥用封禁聚合服务

职责：
- 接收各 Worker 实例上报的"封禁中"IP（abuse.report）；
- 按 IP 去重合并：写入/更新临时黑名单规则（IpRule，rule_type=black），
  expires_at 取各实例上报的最晚封禁到期时间；
- created_by 统一标记为 'worker-abuse'，便于后台页面识别与手动解封。

设计意图：每实例独立内存计数 + 即时封禁，中心端只做去重汇聚与持久化，
再由 runtime_config_service 把合并后的黑名单经长连接回灌各实例，实现跨实例收敛。
"""
import logging
from datetime import datetime
from typing import Any, Dict, List

from src.database import get_db_sync
from src.models_v2 import IpRule
from src.models_v2.base import now

logger = logging.getLogger(__name__)

# 滥用封禁规则的统一创建者标记
ABUSE_CREATED_BY = "worker-abuse"


class AbuseService:
    """非法路由滥用封禁聚合"""

    def ingest_report(self, worker_id: str, banned: List[Dict[str, Any]]) -> int:
        """
        落库去重合并 Worker 上报的封禁 IP 列表。

        banned: [{ ip, banned_until }]，banned_until 为毫秒时间戳。
        返回新增或更新的规则数量。
        """
        if not banned:
            return 0
        db = get_db_sync()
        changed = 0
        try:
            for item in banned:
                ip = (item.get("ip") or "").strip()
                if not ip:
                    continue
                expires_at = self._to_datetime(item.get("banned_until"))
                if expires_at is None:
                    continue

                rule = db.query(IpRule).filter(IpRule.ip_or_cidr == ip).first()
                if rule is None:
                    # 新建临时黑名单规则
                    db.add(IpRule(
                        ip_or_cidr=ip,
                        rule_type="black",
                        reason="非法路由滥用自动封禁",
                        enabled=True,
                        created_by=ABUSE_CREATED_BY,
                        expires_at=expires_at,
                    ))
                    changed += 1
                else:
                    # 已存在：仅对自动封禁规则延长到期时间（取最晚），
                    # 不覆盖人工创建的长期黑名单（expires_at 为空表示长期）
                    if rule.created_by == ABUSE_CREATED_BY:
                        if rule.expires_at is None or expires_at > rule.expires_at:
                            rule.expires_at = expires_at
                            rule.enabled = True
                            rule.updated_at = now()
                            changed += 1
            db.commit()
        except Exception as e:
            db.rollback()
            logger.warning(f"⚠️ 滥用封禁上报落库失败: {e}")
        finally:
            db.close()
        return changed

    @staticmethod
    def _to_datetime(ms: Any) -> datetime | None:
        """毫秒时间戳 → datetime（本地时区，与 IpRule.expires_at 比较口径一致）"""
        try:
            if ms is None:
                return None
            return datetime.fromtimestamp(int(ms) / 1000)
        except Exception:
            return None


abuse_service = AbuseService()
