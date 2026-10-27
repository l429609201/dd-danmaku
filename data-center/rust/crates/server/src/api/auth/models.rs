use serde::{Deserialize, Serialize};

/// 登录请求
#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

/// 登录响应
#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub user: UserInfo,
    pub expires_at: String,
}

/// 用户信息
#[derive(Debug, Serialize, Clone)]
pub struct UserInfo {
    pub id: i64,
    pub username: String,
    pub display_name: Option<String>,
    pub email: Option<String>,
    pub role: String,
    pub is_active: bool,
    pub last_login_at: Option<String>,
    pub created_at: String,
}

/// 修改密码请求
#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub old_password: String,
    pub new_password: String,
}

/// 创建用户请求
#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub password: String,
    pub display_name: Option<String>,
    pub email: Option<String>,
    pub role: String,
}

/// 更新用户请求
#[derive(Debug, Deserialize)]
pub struct UpdateUserRequest {
    pub display_name: Option<String>,
    pub email: Option<String>,
    pub role: Option<String>,
    pub is_active: Option<bool>,
}

/// 重置密码请求
#[derive(Debug, Deserialize)]
pub struct ResetPasswordRequest {
    pub new_password: String,
}

/// 用户列表响应
#[derive(Debug, Serialize)]
pub struct UserListResponse {
    pub users: Vec<UserInfo>,
    pub total: u64,
    pub page: u64,
    pub page_size: u64,
}

/// API Token 信息
#[derive(Debug, Serialize)]
pub struct ApiTokenInfo {
    pub id: i64,
    pub name: String,
    pub token: String,
    pub scopes: Option<Vec<String>>,
    pub last_used_at: Option<String>,
    pub expires_at: Option<String>,
    pub is_active: bool,
    pub created_at: String,
}

/// 创建 API Token 请求
#[derive(Debug, Deserialize)]
pub struct CreateApiTokenRequest {
    pub name: String,
    pub scopes: Option<Vec<String>>,
    pub expires_days: Option<i64>,
}

/// API Token 响应
#[derive(Debug, Serialize)]
pub struct ApiTokenResponse {
    pub token: ApiTokenInfo,
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_login_request_deserialize() {
        let json = r#"{"username":"admin","password":"password123"}"#;
        let req: LoginRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.username, "admin");
        assert_eq!(req.password, "password123");
    }
    
    #[test]
    fn test_user_info_serialize() {
        let user = UserInfo {
            id: 1,
            username: "admin".to_string(),
            display_name: Some("管理员".to_string()),
            email: Some("admin@example.com".to_string()),
            role: "admin".to_string(),
            is_active: true,
            last_login_at: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
        };
        
        let json = serde_json::to_string(&user).unwrap();
        assert!(json.contains("admin"));
        assert!(json.contains("管理员"));
    }
}
