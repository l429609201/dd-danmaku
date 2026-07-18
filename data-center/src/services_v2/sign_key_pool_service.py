"""
客户端签名密钥池管理服务

- 本地端维护签名密钥组（sign_key_pool 表），下发给 Worker 用于验签
- auth_ua_keys 关联 UaLimitRule.ua_key：空=公共组，非空=专属组
- 每组 secret 需与对应内置该密钥、独立编译的 ede.js/sign.wasm 一致
"""
import logging
from typing import Any, Dict, List

from src.database import get_db_sync
from src.models_v2 import SignKeyPool

logger = logging.getLogger(__name__)


class SignKeyPoolService:
    """签名密钥池增删改查 + 下发组装"""

    @staticmethod
    def _brief(r: SignKeyPool, mask: bool = True) -> Dict[str, Any]:
        """密钥组摘要；mask=True 时对 secret 脱敏（仅展示用）"""
        secret = r.secret or ""
        if mask and len(secret) > 8:
            secret_show = secret[:4] + "****" + secret[-4:]
        elif mask:
            secret_show = "****"
        else:
            secret_show = secret
        return {
            "id": r.id,
            "group_id": r.group_id,
            "secret": secret_show,
            "enabled": r.enabled,
            "remark": r.remark,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }

    def list_groups(self, mask: bool = True) -> List[Dict[str, Any]]:
        db = get_db_sync()
        try:
            rows = db.query(SignKeyPool).order_by(SignKeyPool.id.asc()).all()
            return [self._brief(r, mask=mask) for r in rows]
        finally:
            db.close()

    def create_group(self, data: Dict[str, Any]) -> Dict[str, Any]:
        db = get_db_sync()
        try:
            group_id = str(data.get("group_id") or "").strip()
            if not group_id:
                raise ValueError("缺少 group_id")
            if not str(data.get("secret") or "").strip():
                raise ValueError("缺少 secret")
            if db.query(SignKeyPool).filter(SignKeyPool.group_id == group_id).first():
                raise ValueError("该 group_id 已存在")
            row = SignKeyPool(
                group_id=group_id,
                secret=str(data.get("secret") or "").strip(),
                enabled=bool(data.get("enabled", True)),
                remark=data.get("remark"),
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            return self._brief(row)
        finally:
            db.close()

    def update_group(self, pk: int, data: Dict[str, Any]) -> Dict[str, Any]:
        db = get_db_sync()
        try:
            row = db.query(SignKeyPool).filter(SignKeyPool.id == pk).first()
            if not row:
                raise ValueError("密钥组不存在")
            if "secret" in data and data["secret"]:
                row.secret = str(data["secret"]).strip()
            if "enabled" in data and data["enabled"] is not None:
                row.enabled = bool(data["enabled"])
            if "remark" in data:
                row.remark = data["remark"]
            db.commit()
            db.refresh(row)
            return self._brief(row)
        finally:
            db.close()

    def delete_group(self, pk: int) -> bool:
        db = get_db_sync()
        try:
            row = db.query(SignKeyPool).filter(SignKeyPool.id == pk).first()
            if not row:
                return False
            db.delete(row)
            db.commit()
            return True
        finally:
            db.close()

    def build_pool_payload(self) -> List[Dict[str, Any]]:
        """组装下发给 Worker 的签名密钥组列表（仅启用项，明文 secret）"""
        db = get_db_sync()
        try:
            rows = db.query(SignKeyPool).filter(
                SignKeyPool.enabled == True).all()  # noqa: E712
            return [{
                "groupId": r.group_id,
                "secret": r.secret,
            } for r in rows]
        finally:
            db.close()


sign_key_pool_service = SignKeyPoolService()
