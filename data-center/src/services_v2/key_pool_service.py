"""
弹弹play 密钥池管理服务

- 本地端维护密钥列表（app_key_pool 表），下发给 Worker 作为扩充
- authUaKeys 关联 UaLimitRule.ua_key：空=公共池，非空=专属密钥
- 接收 Worker 上报的限流状态快照（worker_key_state 表），供前端展示
"""
import logging
from typing import Any, Dict, List, Optional

from src.database import get_db_sync
from src.models_v2 import AppKeyPool, WorkerKeyState, UaLimitRule
from src.models_v2.base import now

logger = logging.getLogger(__name__)


class KeyPoolService:
    """密钥池增删改查 + 状态接收"""

    @staticmethod
    def _brief(r: AppKeyPool, mask: bool = True) -> Dict[str, Any]:
        """密钥摘要；mask=True 时对 app_secret 脱敏（仅展示用）"""
        secret = r.app_secret or ""
        if mask and len(secret) > 8:
            secret_show = secret[:4] + "****" + secret[-4:]
        elif mask:
            secret_show = "****"
        else:
            secret_show = secret
        return {
            "id": r.id,
            "key_id": r.key_id,
            "app_id": r.app_id,
            "app_secret": secret_show,
            "auth_ua_keys": r.auth_ua_keys or [],
            "enabled": r.enabled,
            "remark": r.remark,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }

    def list_keys(self, mask: bool = True) -> List[Dict[str, Any]]:
        db = get_db_sync()
        try:
            rows = db.query(AppKeyPool).order_by(AppKeyPool.id.asc()).all()
            return [self._brief(r, mask=mask) for r in rows]
        finally:
            db.close()

    def list_ua_keys(self) -> List[Dict[str, Any]]:
        """可选的 ua_key 列表（供前端下拉绑定专属密钥）"""
        db = get_db_sync()
        try:
            rows = db.query(UaLimitRule).order_by(UaLimitRule.id.asc()).all()
            return [{"ua_key": r.ua_key, "user_agent": r.user_agent or ""} for r in rows]
        finally:
            db.close()

    def create_key(self, data: Dict[str, Any]) -> Dict[str, Any]:
        db = get_db_sync()
        try:
            key_id = str(data.get("key_id") or "").strip()
            if not key_id:
                raise ValueError("缺少 key_id")
            if db.query(AppKeyPool).filter(AppKeyPool.key_id == key_id).first():
                raise ValueError("该 key_id 已存在")
            row = AppKeyPool(
                key_id=key_id,
                app_id=str(data.get("app_id") or "").strip(),
                app_secret=str(data.get("app_secret") or "").strip(),
                auth_ua_keys=list(data.get("auth_ua_keys") or []),
                enabled=bool(data.get("enabled", True)),
                remark=data.get("remark"),
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            return self._brief(row)
        finally:
            db.close()

    def update_key(self, key_pk: int, data: Dict[str, Any]) -> Dict[str, Any]:
        db = get_db_sync()
        try:
            row = db.query(AppKeyPool).filter(AppKeyPool.id == key_pk).first()
            if not row:
                raise ValueError("密钥不存在")
            if "app_id" in data and data["app_id"] is not None:
                row.app_id = str(data["app_id"]).strip()
            if "app_secret" in data and data["app_secret"]:
                row.app_secret = str(data["app_secret"]).strip()
            if "auth_ua_keys" in data and data["auth_ua_keys"] is not None:
                row.auth_ua_keys = list(data["auth_ua_keys"])
            if "enabled" in data and data["enabled"] is not None:
                row.enabled = bool(data["enabled"])
            if "remark" in data:
                row.remark = data["remark"]
            db.commit()
            db.refresh(row)
            return self._brief(row)
        finally:
            db.close()

    def delete_key(self, key_pk: int) -> bool:
        db = get_db_sync()
        try:
            row = db.query(AppKeyPool).filter(AppKeyPool.id == key_pk).first()
            if not row:
                return False
            db.delete(row)
            db.commit()
            return True
        finally:
            db.close()

    def build_pool_payload(self) -> List[Dict[str, Any]]:
        """组装下发给 Worker 的密钥列表（仅启用项，明文 secret）"""
        db = get_db_sync()
        try:
            rows = db.query(AppKeyPool).filter(
                AppKeyPool.enabled == True).all()  # noqa: E712
            return [{
                "id": r.key_id,
                "appId": r.app_id,
                "appSecret": r.app_secret,
                "authUaKeys": r.auth_ua_keys or [],
            } for r in rows]
        finally:
            db.close()

    def ingest_key_state(self, payload: Dict[str, Any]) -> bool:
        """接收 Worker 上报的密钥限流状态，按 worker_id upsert"""
        worker_id = str(payload.get("worker_id") or "worker-1")
        db = get_db_sync()
        try:
            row = db.query(WorkerKeyState).filter(
                WorkerKeyState.worker_id == worker_id).first()
            if not row:
                row = WorkerKeyState(worker_id=worker_id)
                db.add(row)
            row.reset_date = payload.get("reset_date")
            row.keys_source = payload.get("keys_source")
            row.key_count = int(payload.get("key_count") or 0)
            row.key_state = payload.get("key_state") or {}
            row.updated_at = now()
            db.commit()
            return True
        except Exception as e:
            db.rollback()
            logger.error(f"❌ 密钥状态落库失败: {e}")
            return False
        finally:
            db.close()


    def export_keys(self) -> Dict[str, Any]:
        """导出全部密钥为 env APP_KEY_POOL 同构格式 { keys: [...] }（明文 secret）"""
        db = get_db_sync()
        try:
            rows = db.query(AppKeyPool).order_by(AppKeyPool.id.asc()).all()
            return {
                "keys": [{
                    "id": r.key_id,
                    "appId": r.app_id,
                    "appSecret": r.app_secret,
                    "authUaKeys": r.auth_ua_keys or [],
                    "enabled": r.enabled,
                    "remark": r.remark or "",
                } for r in rows]
            }
        finally:
            db.close()

    @staticmethod
    def _normalize_import(data) -> List[Dict[str, Any]]:
        """归一化导入数据：支持 { keys:[...] } / 直接数组 / { key_id: {...} } 对象"""
        items: List[Dict[str, Any]] = []
        if isinstance(data, dict) and isinstance(data.get("keys"), list):
            items = [d for d in data["keys"] if isinstance(d, dict)]
        elif isinstance(data, list):
            items = [d for d in data if isinstance(d, dict)]
        elif isinstance(data, dict):
            # 对象格式：{ key_id: { appId, appSecret, authUaKeys } }
            for kid, v in data.items():
                if isinstance(v, dict):
                    items.append({"id": kid, **v})
        return items

    def import_keys(self, data, replace_all: bool = False) -> Dict[str, int]:
        """JSON 导入密钥：按 key_id upsert；replace_all=True 先清空。返回统计"""
        items = self._normalize_import(data)
        created = updated = errors = 0
        db = get_db_sync()
        try:
            if replace_all:
                db.query(AppKeyPool).delete()
            for it in items:
                # 兼容 camelCase(env格式) 与 snake_case
                key_id = str(it.get("id") or it.get("key_id") or "").strip()
                app_id = str(it.get("appId") or it.get("app_id") or "").strip()
                secret = str(it.get("appSecret") or it.get("app_secret") or "").strip()
                ua_keys = it.get("authUaKeys")
                if ua_keys is None:
                    ua_keys = it.get("auth_ua_keys") or []
                if not key_id or not app_id or not secret:
                    errors += 1
                    continue
                row = db.query(AppKeyPool).filter(
                    AppKeyPool.key_id == key_id).first()
                if not row:
                    row = AppKeyPool(key_id=key_id)
                    db.add(row)
                    created += 1
                else:
                    updated += 1
                row.app_id = app_id
                row.app_secret = secret
                row.auth_ua_keys = list(ua_keys) if isinstance(ua_keys, list) else []
                if "enabled" in it and it["enabled"] is not None:
                    row.enabled = bool(it["enabled"])
                if it.get("remark") is not None:
                    row.remark = it.get("remark")
            db.commit()
            return {"created": created, "updated": updated, "errors": errors}
        except Exception as e:
            db.rollback()
            logger.error(f"❌ 密钥导入失败: {e}")
            raise
        finally:
            db.close()

    def get_key_states(self) -> List[Dict[str, Any]]:
        """返回各 Worker 上报的密钥限流状态，供前端展示"""
        db = get_db_sync()
        try:
            rows = db.query(WorkerKeyState).order_by(
                WorkerKeyState.updated_at.desc()).all()
            return [{
                "worker_id": r.worker_id,
                "reset_date": r.reset_date,
                "keys_source": r.keys_source,
                "key_count": r.key_count,
                "key_state": r.key_state or {},
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            } for r in rows]
        finally:
            db.close()


key_pool_service = KeyPoolService()
