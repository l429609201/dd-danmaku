"""
API v2 Pydantic Schema 集中定义（KISS：单文件，避免过度拆分）
"""
from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel


# ---------- 通用 ----------
class ApiResult(BaseModel):
    success: bool = True
    message: str = "ok"
    data: Any | None = None


class PageResult(BaseModel):
    total: int
    items: List[Any]


# ---------- 认证 ----------
class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResult(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


# ---------- 用户与 Token ----------
class UserCreate(BaseModel):
    username: str
    password: str
    display_name: Optional[str] = None
    role: str = "viewer"  # admin/operator/viewer


class UserUpdate(BaseModel):
    display_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


class ApiTokenCreate(BaseModel):
    name: str
    scopes: List[str] = []
    expires_at: Optional[datetime] = None


# ---------- 集数链接 ----------
class EpisodeLinkCreate(BaseModel):
    local_title: str
    season_number: Optional[int] = None
    episode_number: Optional[str] = None
    episode_title: Optional[str] = None
    dandan_anime_id: Optional[str] = None
    dandan_bangumi_id: Optional[str] = None
    dandan_episode_id: str
    anime_title: Optional[str] = None
    match_source: str = "manual"
    confidence: int = 100
    source_cache_key: str
    bangumi_cache_key: Optional[str] = None
    comment_api_path: Optional[str] = None
    comment_cache_key: Optional[str] = None


class EpisodeLinkUpdate(BaseModel):
    dandan_episode_id: Optional[str] = None
    episode_title: Optional[str] = None
    confidence: Optional[int] = None
    comment_cache_key: Optional[str] = None


# ---------- 设置 ----------
class SettingUpdate(BaseModel):
    value: str


# ---------- 控制 ----------
class ConfigApplyRequest(BaseModel):
    ua_configs: Optional[dict] = None
    ip_blacklist: Optional[dict] = None
    cache_policy: Optional[dict] = None
