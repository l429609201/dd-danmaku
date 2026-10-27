use axum::{
    extract::{Request, State},
    middleware::Next,
    response::Response,
    http::StatusCode,
};
use crate::AppState;
use super::jwt::Claims;

/// 认证中间件
pub async fn auth_middleware(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    // 从 Header 中获取 Token
    let token = req
        .headers()
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;
    
    // 验证 Token
    let claims = state
        .jwt
        .verify_token(token)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    
    // 将 Claims 插入到请求扩展中
    req.extensions_mut().insert(claims);
    
    Ok(next.run(req).await)
}

/// 从请求中提取 Claims
pub fn extract_claims(req: &Request) -> Result<Claims, StatusCode> {
    req.extensions()
        .get::<Claims>()
        .cloned()
        .ok_or(StatusCode::UNAUTHORIZED)
}

/// Admin 角色检查中间件
pub async fn admin_middleware(
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let claims = extract_claims(&req)?;
    
    if claims.role != "admin" {
        return Err(StatusCode::FORBIDDEN);
    }
    
    Ok(next.run(req).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_extract_bearer_token() {
        let token = "Bearer eyJhbGciOiJIUzI1NiIs...";
        let extracted = token.strip_prefix("Bearer ");
        assert_eq!(extracted, Some("eyJhbGciOiJIUzI1NiIs..."));
    }
}
