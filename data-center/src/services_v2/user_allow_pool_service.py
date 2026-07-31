"""
用户允许名单池管理服务

- 本地端维护用户组（user_allow_pool 表），下发给 Worker 做用户名过滤
- UA 规则通过 user_group_id 绑定某一组；不绑定则该 UA 不做用户名校验
- 名单值为客户端 X-Ddd-User 头的原值，精确匹配（不做大小写归一，避免误放行）

注意：客户端（ede.js + sign.wasm）送出的 X-Ddd-User 是**混淆后的值**，
不是 Emby 原生用户 ID。因此名单里要填混淆值，可用 obfuscate_user()
由原生 ID 换算（后台"生成"按钮走的就是这个函数）。

与签名密钥池的区别：用户名不是密钥，不做脱敏——排查时需要直接看到具体名单。
"""
import hashlib
import logging
from typing import Any, Dict, List

from src.database import get_db_sync
from src.models_v2 import UserAllowPool

logger = logging.getLogger(__name__)


def obfuscate_user(user_id: str, brand_mark: str, obf_key: str) -> str:
    """
    把 Emby 原生用户 ID 混淆成客户端实际上报的标识值。

    算法必须与 wasm-sign/assembly/index.ts 的 obfuscateUser 完全一致：
        payload   = f"{brand_mark}:{user_id}" 的 UTF-8 字节
        keystream = sha256(obf_key) 循环拼接至 payload 等长
        结果      = hex(payload XOR keystream)

    :return: 小写 hex 串；任一参数为空时返回空串
    """
    if not user_id or not brand_mark or not obf_key:
        return ""
    payload = f"{brand_mark}:{user_id}".encode("utf-8")
    seed = hashlib.sha256(obf_key.encode("utf-8")).digest()
    return bytes(b ^ seed[i % len(seed)] for i, b in enumerate(payload)).hex()


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
            "brand_mark": r.brand_mark or "",
            "obf_key": r.obf_key or "",
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
                brand_mark=(str(data.get("brand_mark") or "").strip() or None),
                obf_key=(str(data.get("obf_key") or "").strip() or None),
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
            # 空串归一为 None，表示不启用实例校验（两者必须同时有值才生效）
            if "brand_mark" in data:
                row.brand_mark = (str(data.get("brand_mark") or "").strip() or None)
            if "obf_key" in data:
                row.obf_key = (str(data.get("obf_key") or "").strip() or None)
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
            result = []
            for r in rows:
                item = {
                    "groupId": r.group_id,
                    "users": r.users_json if isinstance(r.users_json, list) else [],
                }
                # 实例校验参数：两者都有才下发（Worker 侧同样要求两者均存在才启用）
                if r.brand_mark and r.obf_key:
                    item["brandMark"] = r.brand_mark
                    item["obfKey"] = r.obf_key
                result.append(item)
            return result
        finally:
            db.close()


user_allow_pool_service = UserAllowPoolService()
