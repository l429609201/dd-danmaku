use axum::{
    extract::{State, Json, Path, Query, Request},
    Extension,
    http::StatusCode,
};
use serde::Deserialize;
use db::{UserRepo, SessionRepo, ApiTokenRepo};
use crate::{AppState, auth::{Claims, PasswordService, extract_claims}};
use super::models::*;

/// 登录
pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, (StatusCode, String)> {
    // 查找用户
    let user = UserRepo::find_by_username(&state.db, &req.username)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::UNAUTHORIZED, "Invalid username or password".to_string()))?;
    
    // 检查用户是否激活
    if !user.is_active {
        return Err((StatusCode::FORBIDDEN, "User is disabled".to_string()));
    }
    
    // 验证密码
    let password_valid = PasswordService::verify_password(&req.password, &user.password_hash)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    if !password_valid {
        return Err((StatusCode::UNAUTHORIZED, "Invalid username or password".to_string()));
    }
    
    // 生成 JWT Token
    let token = state.jwt.generate_token(user.id, &user.username, &user.role)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    // 计算过期时间
    let expires_at = chrono::Utc::now() + state.jwt.expiry_duration();
    
    // 保存会话到数据库
    SessionRepo::create(
        &state.db,
        user.id,
        token.clone(),
        None, // IP 地址（从请求中提取）
        None, // User-Agent（从请求中提取）
        expires_at,
    )
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    // 更新最后登录时间
    UserRepo::update_last_login(&state.db, user.id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    // 构造响应
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
    
    Ok(Json(LoginResponse {
        token,
        user: user_info,
        expires_at: expires_at.to_rfc3339(),
    }))
}

/// 登出
pub async fn logout(
    State(state): State<AppState>,
    req: Request,
) -> Result<StatusCode, (StatusCode, String)> {
    // 从 Header 中获取 Token
    let token = req
        .headers()
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .ok_or((StatusCode::UNAUTHORIZED, "Missing token".to_string()))?;
    
    // 删除会话
    SessionRepo::delete_by_token(&state.db, token)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    Ok(StatusCode::NO_CONTENT)
}

/// 获取当前用户信息
pub async fn get_me(
    State(state): State<AppState>,
    req: Request,
) -> Result<Json<UserInfo>, (StatusCode, String)> {
    let claims = extract_claims(&req)
        .map_err(|_| (StatusCode::UNAUTHORIZED, "Unauthorized".to_string()))?;
    
    let user_id: i64 = claims.sub.parse()
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Invalid user ID".to_string()))?;
    
    let user = UserRepo::find_by_id(&state.db, user_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
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

/// 修改密码
pub async fn change_password(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(change_req): Json<ChangePasswordRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    
    let user_id: i64 = claims.sub.parse()
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Invalid user ID".to_string()))?;
    
    // 获取用户
    let user = UserRepo::find_by_id(&state.db, user_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;
    
    // 验证旧密码
    let password_valid = PasswordService::verify_password(&change_req.old_password, &user.password_hash)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    if !password_valid {
        return Err((StatusCode::UNAUTHORIZED, "Old password is incorrect".to_string()));
    }
    
    // 哈希新密码
    let new_password_hash = PasswordService::hash_password(&change_req.new_password)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    // 更新密码
    UserRepo::update_password(&state.db, user_id, new_password_hash)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    // 删除该用户的所有会话（强制重新登录）
    SessionRepo::delete_by_user_id(&state.db, user_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    Ok(StatusCode::NO_CONTENT)
}

/// 刷新 Token
pub async fn refresh_token(
    State(state): State<AppState>,
    req: Request,
) -> Result<Json<LoginResponse>, (StatusCode, String)> {
    let claims = extract_claims(&req)
        .map_err(|_| (StatusCode::UNAUTHORIZED, "Unauthorized".to_string()))?;
    
    let user_id: i64 = claims.sub.parse()
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "Invalid user ID".to_string()))?;
    
    // 获取用户
    let user = UserRepo::find_by_id(&state.db, user_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "User not found".to_string()))?;
    
    // 生成新 Token
    let new_token = state.jwt.generate_token(user.id, &user.username, &user.role)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    // 计算过期时间
    let expires_at = chrono::Utc::now() + state.jwt.expiry_duration();
    
    // 从 Header 中获取旧 Token
    let old_token = req
        .headers()
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .ok_or((StatusCode::UNAUTHORIZED, "Missing token".to_string()))?;
    
    // 删除旧会话
    SessionRepo::delete_by_token(&state.db, old_token)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    // 保存新会话
    SessionRepo::create(
        &state.db,
        user.id,
        new_token.clone(),
        None,
        None,
        expires_at,
    )
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    // 构造响应
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
    
    Ok(Json(LoginResponse {
        token: new_token,
        user: user_info,
        expires_at: expires_at.to_rfc3339(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_extract_bearer_token() {
        let header = "Bearer eyJhbGci...";
        let token = header.strip_prefix("Bearer ");
        assert_eq!(token, Some("eyJhbGci..."));
    }
}
