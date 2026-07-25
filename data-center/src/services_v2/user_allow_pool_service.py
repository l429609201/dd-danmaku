"""
用户允许名单池管理服务

- 本地端维护用户组（user_allow_pool 表），下发给 Worker 做用户名过滤
- UA 规则通过 user_group_id 绑定某一组；不绑定则该 UA 不做用户名校验
- 名单值为客户端 X-Ddd-User 头的原值，精确匹配（不做大小写归一，避免误放行）

与签名密钥池的区别：用户名不是密钥，不做脱敏——排查时需要直接看到具体名单。
"""
import logging
from typing import Any, Dict, List

from src.database import get_db_sync
from src.models_v2 import UserAllowPool

logger = logging.getLogger(__name__)


def _norm_users(value: Any) -> List[str]:
    """规范化用户名列表：支持列表或换行/逗号分隔字符串，去空去重且保持顺序"""
    if value is None:
        return []
    if isinstance(value, str):
        # 前端文本域可能用换行或逗号分隔，统一切分
        raw = [x for part in value.replace(",", "\n").split("\n") for x in [part.strip()]]
    elif isinstance(value, (list, tuple)):
        raw = [str(x).strip() for x in value]
    else:
        return []
    seen = set()
    out = []
    for item in raw:
        if not item or item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


class UserAllowPoolService:
    """用户名单组增删改查 + 下发组装"""

    @staticmethod
    def _brief(r: UserAllowPool) -> Dict[str, Any]:
        users = r.users_json if isinstance(r.users_json, list) else []
        return {
            "id": r.id,
            "group_id": r.group_id,
            "users": users,
            "user_count": len(users),
            "enabled": r.enabled,
            "remark": r.remark,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }

    def list_groups(self) -> List[Dict[str, Any]]:
        db = get_db_sync()
        try:
            rows = db.query(UserAllowPool).order_by(UserAllowPool.id.asc()).all()
            return [self._brief(r) for r in rows]
        finally:
            db.close()

    def create_group(self, data: Dict[str, Any]) -> Dict[str, Any]:
        db = get_db_sync()
        try:
            group_id = str(data.get("group_id") or "").strip()
            if not group_id:
                raise ValueError("缺少 group_id")
            if db.query(UserAllowPool).filter(
                    UserAllowPool.group_id == group_id).first():
                raise ValueError("该 group_id 已存在")
            row = UserAllowPool(
                group_id=group_id,
                users_json=_norm_users(data.get("users")),
                enabled=bool(data.get("enabled", True)),
                remark=data.get("remark"),
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            return self._brief(row)
        except ValueError:
            db.rollback()
            raise
        except Exception as e:
            db.rollback()
            logger.error(f"❌ 用户名单组创建失败(DB): {e}")
            raise
        finally:
            db.close()

    def update_group(self, pk: int, data: Dict[str, Any]) -> Dict[str, Any]:
        db = get_db_sync()
        try:
            row = db.query(UserAllowPool).filter(UserAllowPool.id == pk).first()
            if not row:
                raise ValueError("用户名单组不存在")
            # users 显式传入才更新（允许传空列表来清空名单）
            if "users" in data:
                row.users_json = _norm_users(data.get("users"))
            if "enabled" in data and data["enabled"] is not None:
                row.enabled = bool(data["enabled"])
            if "remark" in data:
                row.remark = data["remark"]
            db.commit()
            db.refresh(row)
            return self._brief(row)
        except ValueError:
            db.rollback()
            raise
        finally:
            db.close()

    def delete_group(self, pk: int) -> bool:
        db = get_db_sync()
        try:
            row = db.query(UserAllowPool).filter(UserAllowPool.id == pk).first()
            if not row:
                return False
            db.delete(row)
            db.commit()
            return True
        finally:
            db.close()

    def build_pool_payload(self) -> List[Dict[str, Any]]:
        """组装下发给 Worker 的用户名单组列表（仅启用项）"""
        db = get_db_sync()
        try:
            rows = db.query(UserAllowPool).filter(
                UserAllowPool.enabled == True).all()  # noqa: E712
            return [{
                "groupId": r.group_id,
                "users": r.users_json if isinstance(r.users_json, list) else [],
            } for r in rows]
        finally:
            db.close()


user_allow_pool_service = UserAllowPoolService()
