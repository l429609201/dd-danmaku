use jsonwebtoken::{encode, decode, Header, Validation, EncodingKey, DecodingKey, Algorithm};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// JWT Claims
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,        // 用户 ID
    pub username: String,   // 用户名
    pub role: String,       // 角色
    pub exp: u64,          // 过期时间（Unix timestamp）
    pub iat: u64,          // 签发时间
}

/// JWT 服务
pub struct JwtService {
    secret: String,
    expiry_hours: i64,
}

impl JwtService {
    /// 创建 JWT 服务
    pub fn new(secret: String, expiry_hours: i64) -> Self {
        Self {
            secret,
            expiry_hours,
        }
    }
    
    /// 生成 Token
    pub fn generate_token(
        &self,
        user_id: i64,
        username: &str,
        role: &str,
    ) -> Result<String, jsonwebtoken::errors::Error> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        
        let exp = now + (self.expiry_hours * 3600) as u64;
        
        let claims = Claims {
            sub: user_id.to_string(),
            username: username.to_string(),
            role: role.to_string(),
            exp,
            iat: now,
        };
        
        encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(self.secret.as_bytes()),
        )
    }
    
    /// 验证 Token
    pub fn verify_token(&self, token: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
        decode::<Claims>(
            token,
            &DecodingKey::from_secret(self.secret.as_bytes()),
            &Validation::new(Algorithm::HS256),
        )
        .map(|data| data.claims)
    }
    
    /// 计算过期时间
    pub fn expiry_duration(&self) -> chrono::Duration {
        chrono::Duration::hours(self.expiry_hours)
    }
}

/// 密码哈希服务
pub struct PasswordService;

impl PasswordService {
    /// 哈希密码
    pub fn hash_password(password: &str) -> Result<String, bcrypt::BcryptError> {
        bcrypt::hash(password, bcrypt::DEFAULT_COST)
    }
    
    /// 验证密码
    pub fn verify_password(password: &str, hash: &str) -> Result<bool, bcrypt::BcryptError> {
        bcrypt::verify(password, hash)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_jwt_generate_and_verify() {
        let jwt = JwtService::new("test_secret_key_12345".to_string(), 24);
        
        let token = jwt.generate_token(1, "admin", "admin").unwrap();
        assert!(!token.is_empty());
        
        let claims = jwt.verify_token(&token).unwrap();
        assert_eq!(claims.sub, "1");
        assert_eq!(claims.username, "admin");
        assert_eq!(claims.role, "admin");
    }
    
    #[test]
    fn test_jwt_invalid_token() {
        let jwt = JwtService::new("test_secret_key_12345".to_string(), 24);
        
        let result = jwt.verify_token("invalid.token.here");
        assert!(result.is_err());
    }
    
    #[test]
    fn test_password_hash_and_verify() {
        let password = "test_password_123";
        
        let hash = PasswordService::hash_password(password).unwrap();
        assert!(!hash.is_empty());
        assert_ne!(hash, password);
        
        let valid = PasswordService::verify_password(password, &hash).unwrap();
        assert!(valid);
        
        let invalid = PasswordService::verify_password("wrong_password", &hash).unwrap();
        assert!(!invalid);
    }
}
