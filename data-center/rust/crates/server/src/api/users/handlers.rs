use axum::{
    extract::{State, Json, Path, Query},
    http::StatusCode,
};
use serde::Deserialize;
use db::{UserRepo, ApiTokenRepo};
use crate::{AppState, auth::PasswordService};
use crate::api::auth::models::*;

/// 分页查询参数
#[derive(Debug, Deserialize)]
pub struct PaginationQuery {
    #[serde(default = "default_page")]
    pub page: u64,
    #[serde(default = "default_page_size")]
    pub page_size: u64,
}

fn default_page() -> u64 { 1 }
fn default_page_size() -> u64 { 20 }

/// 获取用户列表
pub async fn get_users(
    State(state): State<AppState>,
    Query(query): Query<PaginationQuery>,
) -> Result<Json<UserListResponse>, (StatusCode, String)> {
    let page = query.page.max(1);
    let page_size = query.page_size.min(100).max(1);
    // 拒绝溢出分页，避免请求触发 panic 或错误偏移。
    let offset = (page - 1).checked_mul(page_size)
        .filter(|offset| *offset <= i64::MAX as u64)
        .ok_or((StatusCode::BAD_REQUEST, "分页超出范围".to_string()))?;
    
    // 查询用户列表
    let users = UserRepo::find_all(&state.db, offset, page_size)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "用户数据操作失败".to_string()))?;
    
    // 查询总数
    let total = UserRepo::count(&state.db)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "用户数据操作失败".to_string()))?;
    
    // 转换为 UserInfo
    let user_infos: Vec<UserInfo> = users.into_iter().map(|u| UserInfo {
        id: u.id,
        username: u.username,
        display_name: u.display_name,
        email: u.email,
        role: u.role,
        is_active: u.is_active,
        last_login_at: u.last_login_at.map(|t| t.and_utc().to_rfc3339()),
        created_at: u.created_at.and_utc().to_rfc3339(),
    }).collect();
    
    Ok(Json(UserListResponse {
        users: user_infos,
        total,
        page,
        page_size,
    }))
}

/// 获取用户详情
pub async fn get_user(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<UserInfo>, (StatusCode, String)> {
    let user = UserRepo::find_by_id(&state.db, id)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "用户数据操作失败".to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;
    
    let user_info = UserInfo {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        email: user.email,
        role: user.role,
        is_active: user.is_active,
        last_login_at: user.last_login_at.map(|t| t.and_utc().to_rfc3339()),
        created_at: user.created_at.and_utc().to_rfc3339(),
    };
    
    Ok(Json(user_info))
}

/// 创建用户
pub async fn create_user(
    State(state): State<AppState>,
    Json(req): Json<CreateUserRequest>,
) -> Result<Json<UserInfo>, (StatusCode, String)> {
    // 写入前校验身份字段，避免空密码和不可识别角色。
    validate_password(&req.password)?;
    validate_role(&req.role)?;
    if req.username.trim().is_empty() || req.username.len() > 128 {
        return Err((StatusCode::BAD_REQUEST, "用户名长度必须为 1–128 字节".to_string()));
    }
    // 检查用户名是否已存在
    let existing = UserRepo::find_by_username(&state.db, &req.username)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "用户数据操作失败".to_string()))?;
    
    if existing.is_some() {
        return Err((StatusCode::CONFLICT, "Username already exists".to_string()));
    }
    
    // 哈希密码
    let password_hash = PasswordService::hash_password(&req.password)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "用户数据操作失败".to_string()))?;
    
    // 创建用户
    let user = UserRepo::create(
        &state.db,
        req.username,
        password_hash,
        req.display_name,
        req.email,
        req.role,
    )
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "用户数据操作失败".to_string()))?;
    
    let user_info = UserInfo {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        email: user.email,
        role: user.role,
        is_active: user.is_active,
        last_login_at: user.last_login_at.map(|t| t.and_utc().to_rfc3339()),
        created_at: user.created_at.and_utc().to_rfc3339(),
    };
    
    Ok(Json(user_info))
}

/// 更新用户
pub async fn update_user(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<UpdateUserRequest>,
) -> Result<Json<UserInfo>, (StatusCode, String)> {
    // 角色仅接受后台约定的有限集合。
    if let Some(role) = &req.role { validate_role(role)?; }
    let user = UserRepo::update(
        &state.db,
        id,
        req.display_name,
        req.email,
        req.role,
        req.is_active,
    )
    .await
    .map_err(|e| match e {
        sea_orm::DbErr::RecordNotFound(_) => (StatusCode::NOT_FOUND, "User not found".to_string()),
        _ => (StatusCode::INTERNAL_SERVER_ERROR, "用户数据操作失败".to_string()),
    })?;
    
    // Repository 将停用与撤销会话放在同一事务中，重新启用不复活旧登录。
    let user_info = UserInfo {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        email: user.email,
        role: user.role,
        is_active: user.is_active,
        last_login_at: user.last_login_at.map(|t| t.and_utc().to_rfc3339()),
        created_at: user.created_at.and_utc().to_rfc3339(),
    };
    
    Ok(Json(user_info))
}

/// 删除用户
pub async fn delete_user(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, (StatusCode, String)> {
    UserRepo::delete(&state.db, id)
        .await
        .map_err(|e| match e {
            sea_orm::DbErr::RecordNotFound(_) => (StatusCode::NOT_FOUND, "User not found".to_string()),
            _ => (StatusCode::INTERNAL_SERVER_ERROR, "删除用户失败".to_string()),
        })?;
    
    Ok(StatusCode::NO_CONTENT)
}

/// 重置用户密码
pub async fn reset_user_password(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<ResetPasswordRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    validate_password(&req.new_password)?;
    // 哈希新密码
    let password_hash = PasswordService::hash_password(&req.new_password)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "用户数据操作失败".to_string()))?;
    
    // 更新密码
    UserRepo::update_password(&state.db, id, password_hash)
        .await
        .map_err(|e| match e {
            sea_orm::DbErr::RecordNotFound(_) => (StatusCode::NOT_FOUND, "User not found".to_string()),
            _ => (StatusCode::INTERNAL_SERVER_ERROR, "用户数据操作失败".to_string()),
        })?;
    
    // Repository 将重置密码与撤销会话放在同一事务中。
    Ok(StatusCode::NO_CONTENT)
}

/// 获取用户的 API Tokens
pub async fn get_user_tokens(
    State(state): State<AppState>,
    Path(user_id): Path<i64>,
) -> Result<Json<Vec<ApiTokenInfo>>, (StatusCode, String)> {
    let tokens = ApiTokenRepo::find_by_user_id(&state.db, user_id)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "用户数据操作失败".to_string()))?;
    
    let token_infos: Vec<ApiTokenInfo> = tokens.into_iter().map(|t| {
        let scopes = t.scopes.and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok());
        
        ApiTokenInfo {
            id: t.id,
            name: t.name,
            // 列表只返回摘要，明文仅在创建时提供一次。
            token: format!("{}…", t.token.chars().take(7).collect::<String>()),
            scopes,
            last_used_at: t.last_used_at.map(|dt| dt.and_utc().to_rfc3339()),
            expires_at: t.expires_at.map(|dt| dt.and_utc().to_rfc3339()),
            is_active: t.is_active,
            created_at: t.created_at.and_utc().to_rfc3339(),
        }
    }).collect();
    
    Ok(Json(token_infos))
}

/// 创建 API Token
pub async fn create_user_token(
    State(state): State<AppState>,
    Path(user_id): Path<i64>,
    Json(req): Json<CreateApiTokenRequest>,
) -> Result<Json<ApiTokenResponse>, (StatusCode, String)> {
    // 限制有效期，避免 chrono 溢出及无效的过去时间。
    if req.name.trim().is_empty() || req.name.len() > 128
        || req.expires_days.is_some_and(|days| !(1..=36500).contains(&days)) {
        return Err((StatusCode::BAD_REQUEST, "Token 名称或有效期无效".to_string()));
    }
    UserRepo::find_by_id(&state.db, user_id).await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "查询用户失败".to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;
    // 生成随机 Token
    let token = format!("sk_{}", uuid::Uuid::new_v4().to_string().replace('-', ""));
    
    // 计算过期时间
    let expires_at = req.expires_days.map(|days| {
        chrono::Utc::now() + chrono::Duration::days(days)
    });
    
    // 序列化 scopes
    let scopes_json = req.scopes.as_ref().map(|s| {
        serde_json::to_string(s).unwrap_or_else(|_| "[]".to_string())
    });
    
    // 创建 Token
    let api_token = ApiTokenRepo::create(
        &state.db,
        user_id,
        req.name,
        token,
        scopes_json,
        expires_at,
    )
    .await
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "用户数据操作失败".to_string()))?;
    
    let scopes = api_token.scopes.and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok());
    
    let token_info = ApiTokenInfo {
        id: api_token.id,
        name: api_token.name,
        token: api_token.token,
        scopes,
        last_used_at: api_token.last_used_at.map(|dt| dt.and_utc().to_rfc3339()),
        expires_at: api_token.expires_at.map(|dt| dt.and_utc().to_rfc3339()),
        is_active: api_token.is_active,
        created_at: api_token.created_at.and_utc().to_rfc3339(),
    };
    
    Ok(Json(ApiTokenResponse { token: token_info }))
}

/// 删除 API Token
pub async fn delete_user_token(
    State(state): State<AppState>,
    Path((user_id, token_id)): Path<(i64, i64)>,
) -> Result<StatusCode, (StatusCode, String)> {
    // URL 中的用户必须拥有该 Token，禁止跨用户删除。
    let tokens = ApiTokenRepo::find_by_user_id(&state.db, user_id).await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "查询 Token 失败".to_string()))?;
    if !tokens.iter().any(|token| token.id == token_id) {
        return Err((StatusCode::NOT_FOUND, "Token not found".to_string()));
    }
    ApiTokenRepo::delete(&state.db, token_id)
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "用户数据操作失败".to_string()))?;
    
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_pagination_query() {
        let query = PaginationQuery { page: 1, page_size: 20 };
        assert_eq!(query.page, 1);
        assert_eq!(query.page_size, 20);
    }
}

// 密码使用 bcrypt，超过 72 字节会截断，必须明确拒绝。
pub(crate) fn validate_password(password: &str) -> Result<(), (StatusCode, String)> {
    if password.len() < 8 || password.len() > 72 {
        return Err((StatusCode::BAD_REQUEST, "密码长度必须为 8–72 字节".to_string()));
    }
    Ok(())
}

fn validate_role(role: &str) -> Result<(), (StatusCode, String)> {
    if !matches!(role, "admin" | "operator" | "viewer") {
        return Err((StatusCode::BAD_REQUEST, "无效角色".to_string()));
    }
    Ok(())
}
