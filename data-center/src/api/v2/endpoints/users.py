"""
用户与 API Token 管理（仅 admin）
"""
import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException

from src.api.v2.deps import require_admin
from src.api.v2.schemas import ApiResult, ApiTokenCreate, UserCreate, UserUpdate
from src.database import get_db_sync
from src.models_v2 import LocalApiToken, LocalUser
from src.models_v2.base import now

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("")
async def list_users(_: LocalUser = Depends(require_admin)):
    """用户列表"""
    db = get_db_sync()
    try:
        users = db.query(LocalUser).order_by(LocalUser.id.asc()).all()
        return ApiResult(data=[u.to_dict() for u in users])
    finally:
        db.close()


@router.post("")
async def create_user(body: UserCreate, _: LocalUser = Depends(require_admin)):
    """新增用户"""
    if body.role not in ("admin", "operator", "viewer"):
        raise HTTPException(status_code=400, detail="非法角色")
    db = get_db_sync()
    try:
        if db.query(LocalUser).filter(LocalUser.username == body.username).first():
            raise HTTPException(status_code=409, detail="用户名已存在")
        user = LocalUser(
            username=body.username, display_name=body.display_name,
            role=body.role, is_active=True,
        )
        user.set_password(body.password)
        db.add(user)
        db.commit()
        db.refresh(user)
        return ApiResult(message="创建成功", data=user.to_dict())
    finally:
        db.close()


@router.put("/{user_id}")
async def update_user(user_id: int, body: UserUpdate,
                      _: LocalUser = Depends(require_admin)):
    """更新用户"""
    db = get_db_sync()
    try:
        user = db.query(LocalUser).filter(LocalUser.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        if body.display_name is not None:
            user.display_name = body.display_name
        if body.role is not None:
            if body.role not in ("admin", "operator", "viewer"):
                raise HTTPException(status_code=400, detail="非法角色")
            user.role = body.role
        if body.is_active is not None:
            user.is_active = body.is_active
        if body.password:
            user.set_password(body.password)
        db.commit()
        db.refresh(user)
        return ApiResult(message="更新成功", data=user.to_dict())
    finally:
        db.close()


@router.delete("/{user_id}")
async def delete_user(user_id: int, current: LocalUser = Depends(require_admin)):
    """删除用户（不能删自己）"""
    if user_id == current.id:
        raise HTTPException(status_code=400, detail="不能删除当前登录用户")
    db = get_db_sync()
    try:
        user = db.query(LocalUser).filter(LocalUser.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")
        db.delete(user)
        db.commit()
        return ApiResult(message="删除成功")
    finally:
        db.close()


# ---------- API Token ----------
@router.get("/api-tokens/list")
async def list_tokens(_: LocalUser = Depends(require_admin)):
    """Token 列表（只显示 hash 摘要）"""
    db = get_db_sync()
    try:
        tokens = db.query(LocalApiToken).order_by(LocalApiToken.id.asc()).all()
        return ApiResult(data=[{
            "id": t.id, "user_id": t.user_id, "name": t.name,
            "token_digest": t.token_hash[:12] + "...",
            "scopes": t.scopes_json or [], "is_active": t.is_active,
            "last_used_at": t.last_used_at.isoformat() if t.last_used_at else None,
            "expires_at": t.expires_at.isoformat() if t.expires_at else None,
        } for t in tokens])
    finally:
        db.close()


@router.post("/api-tokens")
async def create_token(body: ApiTokenCreate,
                       current: LocalUser = Depends(require_admin)):
    """创建 Token，仅此次返回明文"""
    raw = secrets.token_urlsafe(32)
    db = get_db_sync()
    try:
        token = LocalApiToken(
            user_id=current.id, name=body.name,
            token_hash=LocalApiToken.hash_token(raw),
            scopes_json=body.scopes, is_active=True,
            expires_at=body.expires_at,
        )
        db.add(token)
        db.commit()
        db.refresh(token)
        return ApiResult(message="创建成功，请妥善保存明文 Token",
                         data={"id": token.id, "token": raw})
    finally:
        db.close()


@router.delete("/api-tokens/{token_id}")
async def delete_token(token_id: int, _: LocalUser = Depends(require_admin)):
    """删除 Token"""
    db = get_db_sync()
    try:
        token = db.query(LocalApiToken).filter(LocalApiToken.id == token_id).first()
        if not token:
            raise HTTPException(status_code=404, detail="Token 不存在")
        db.delete(token)
        db.commit()
        return ApiResult(message="删除成功")
    finally:
        db.close()
