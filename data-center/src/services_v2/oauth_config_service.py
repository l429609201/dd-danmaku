"""
OAuth 配置服务：读取 DB 中的 OAuthConfig 并组装下发 payload。

下发结构与 Worker 侧 env.OAUTH_CONFIG 完全一致，Worker 无需感知来源。
"""
import logging
from typing import Any, Dict, Optional

from src.database import get_db_sync
from src.models_v2 import OAuthConfig

logger = logging.getLogger(__name__)

# 敏感字段占位符（用于脱敏展示，不用于实际校验）
_REDACTED = "***REDACTED***"


class OAuthConfigService:

    def get_active(self) -> Optional[OAuthConfig]:
        """取唯一生效记录（enabled=True，多条取 id 最小者）"""
        db = get_db_sync()
        try:
            return db.query(OAuthConfig).filter(
                OAuthConfig.enabled == True  # noqa: E712
            ).order_by(OAuthConfig.id.asc()).first()
        finally:
            db.close()

    def build_payload(self) -> Optional[Dict[str, Any]]:
        """组装下发 payload；无生效记录时返回 None（Worker 回落 env 兜底）。

        返回格式与 Worker 侧 env.OAUTH_CONFIG 的 JSON 结构完全一致：
        {
          "enabled": true,
          "jwtSecret": "...",
          "jwtExpireHours": 720,
          "allowedUsers": {"alice": true},
          "providers": {
            "github": {
              "clientId": "...", "clientSecret": "...",
              "authorizeUrl": "...", "tokenUrl": "...",
              "userInfoUrl": "...", "scope": "read:user user:email"
            }
          }
        }
        """
        row = self.get_active()
        if row is None:
            return None
        return {
            "enabled": bool(row.enabled),
            "jwtSecret": row.jwt_secret or "",
            "jwtExpireHours": row.jwt_expire_hours or 720,
            "allowedUsers": row.allowed_users_json or {},
            "providers": row.providers_json or {},
        }

    def to_brief(self, row: OAuthConfig) -> Dict[str, Any]:
        """脱敏摘要（用于列表/详情接口）"""
        providers_brief = {}
        for name, cfg in (row.providers_json or {}).items():
            providers_brief[name] = {
                "clientId": cfg.get("clientId", ""),
                # clientSecret 脱敏
                "clientSecret": _REDACTED if cfg.get("clientSecret") else "",
                "authorizeUrl": cfg.get("authorizeUrl", ""),
                "tokenUrl": cfg.get("tokenUrl", ""),
                "userInfoUrl": cfg.get("userInfoUrl", ""),
                "scope": cfg.get("scope", ""),
            }
        return {
            "id": row.id,
            "enabled": row.enabled,
            "jwtSecret": _REDACTED if row.jwt_secret else "",
            "jwtExpireHours": row.jwt_expire_hours,
            "allowedUsers": row.allowed_users_json or {},
            "providers": providers_brief,
            "remark": row.remark,
            "createdAt": row.created_at.isoformat() if row.created_at else None,
            "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
        }

    def create(self, data: Dict[str, Any]) -> OAuthConfig:
        db = get_db_sync()
        try:
            row = OAuthConfig(
                enabled=bool(data.get("enabled", False)),
                jwt_secret=data.get("jwtSecret", ""),
                jwt_expire_hours=int(data.get("jwtExpireHours", 720)),
                allowed_users_json=data.get("allowedUsers") or {},
                providers_json=data.get("providers") or {},
                remark=data.get("remark"),
            )
            db.add(row)
            db.commit()
            db.refresh(row)
            return row
        finally:
            db.close()

    def update(self, row_id: int, data: Dict[str, Any]) -> Optional[OAuthConfig]:
        db = get_db_sync()
        try:
            row = db.query(OAuthConfig).filter(OAuthConfig.id == row_id).first()
            if not row:
                return None
            if "enabled" in data:
                row.enabled = bool(data["enabled"])
            if "jwtSecret" in data and data["jwtSecret"] != _REDACTED:
                row.jwt_secret = data["jwtSecret"]
            if "jwtExpireHours" in data:
                row.jwt_expire_hours = int(data["jwtExpireHours"])
            if "allowedUsers" in data:
                row.allowed_users_json = data["allowedUsers"] or {}
            if "providers" in data:
                # 逐 provider 合并，clientSecret=REDACTED 时保留旧值
                old = dict(row.providers_json or {})
                for name, cfg in (data["providers"] or {}).items():
                    merged = dict(old.get(name) or {})
                    merged.update({k: v for k, v in cfg.items()
                                   if k != "clientSecret" or v != _REDACTED})
                    old[name] = merged
                row.providers_json = old
            if "remark" in data:
                row.remark = data.get("remark")
            db.commit()
            db.refresh(row)
            return row
        finally:
            db.close()

    def delete(self, row_id: int) -> bool:
        db = get_db_sync()
        try:
            row = db.query(OAuthConfig).filter(OAuthConfig.id == row_id).first()
            if not row:
                return False
            db.delete(row)
            db.commit()
            return True
        finally:
            db.close()

    # ------------------------------------------------------------------ #
    # 导入 / 导出                                                          #
    # ------------------------------------------------------------------ #

    def export_all(self) -> list:
        """导出全部配置为 JSON 列表（jwtSecret/clientSecret 明文导出，用于备份/迁移）。

        与 to_brief 不同，此处不脱敏——导出文件本身就是凭据备份，
        应由调用者保管，接口层做 admin 鉴权。
        """
        db = get_db_sync()
        try:
            rows = db.query(OAuthConfig).order_by(OAuthConfig.id.asc()).all()
            result = []
            for r in rows:
                result.append({
                    "enabled": r.enabled,
                    "jwtSecret": r.jwt_secret or "",
                    "jwtExpireHours": r.jwt_expire_hours or 720,
                    "allowedUsers": r.allowed_users_json or {},
                    "providers": r.providers_json or {},
                    "remark": r.remark or "",
                })
            return result
        finally:
            db.close()

    def import_from_json(self, data: Any, replace_all: bool = False) -> Dict[str, int]:
        """从 JSON 导入配置。

        支持两种格式（与 Worker 侧 env.OAUTH_CONFIG 兼容）：
        - 单对象：{ enabled, jwtSecret, providers, ... }
        - 列表：[{ enabled, jwtSecret, ... }, ...]

        replace_all=True 时先清空表再导入；False 时仅追加（不更新已有记录）。
        返回 {"created": n, "skipped": n, "errors": n}
        """
        if isinstance(data, dict):
            items = [data]
        elif isinstance(data, list):
            items = data
        else:
            raise ValueError("JSON 格式错误：需为对象或数组")

        db = get_db_sync()
        created = skipped = errors = 0
        try:
            if replace_all:
                db.query(OAuthConfig).delete()
                db.commit()

            for item in items:
                if not isinstance(item, dict):
                    errors += 1
                    continue
                try:
                    row = OAuthConfig(
                        enabled=bool(item.get("enabled", False)),
                        jwt_secret=item.get("jwtSecret") or item.get("jwt_secret") or "",
                        jwt_expire_hours=int(item.get("jwtExpireHours") or
                                             item.get("jwt_expire_hours") or 720),
                        allowed_users_json=item.get("allowedUsers") or
                                           item.get("allowed_users_json") or {},
                        providers_json=item.get("providers") or
                                       item.get("providers_json") or {},
                        remark=item.get("remark"),
                    )
                    db.add(row)
                    db.commit()
                    created += 1
                except Exception as e:
                    db.rollback()
                    logger.warning(f"⚠️ OAuth 配置导入单条失败（跳过）: {e}")
                    errors += 1

            return {"created": created, "skipped": skipped, "errors": errors}
        finally:
            db.close()


oauth_config_service = OAuthConfigService()
