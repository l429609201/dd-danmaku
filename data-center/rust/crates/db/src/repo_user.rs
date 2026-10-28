use sea_orm::*;
use crate::entities::{app_user, app_user_session, app_user_api_token};

/// 用户 Repository
pub struct UserRepo;

impl UserRepo {
    /// 根据用户名查找用户
    pub async fn find_by_username(
        db: &DatabaseConnection,
        username: &str,
    ) -> Result<Option<app_user::Model>, DbErr> {
        app_user::Entity::find()
            .filter(app_user::Column::Username.eq(username))
            .one(db)
            .await
    }
    
    /// 根据 ID 查找用户
    pub async fn find_by_id(
        db: &DatabaseConnection,
        id: i64,
    ) -> Result<Option<app_user::Model>, DbErr> {
        app_user::Entity::find_by_id(id)
            .one(db)
            .await
    }
    
    /// 查找所有用户
    pub async fn find_all(
        db: &DatabaseConnection,
        offset: u64,
        limit: u64,
    ) -> Result<Vec<app_user::Model>, DbErr> {
        app_user::Entity::find()
            .order_by_desc(app_user::Column::CreatedAt)
            .offset(offset)
            .limit(limit)
            .all(db)
            .await
    }
    
    /// 统计用户数量
    pub async fn count(db: &DatabaseConnection) -> Result<u64, DbErr> {
        app_user::Entity::find().count(db).await
    }
    
    /// 创建用户
    pub async fn create(
        db: &DatabaseConnection,
        username: String,
        password_hash: String,
        display_name: Option<String>,
        email: Option<String>,
        role: String,
    ) -> Result<app_user::Model, DbErr> {
        let now = chrono::Utc::now().naive_utc();
        
        let user = app_user::ActiveModel {
            username: Set(username),
            password_hash: Set(password_hash),
            display_name: Set(display_name),
            email: Set(email),
            role: Set(role),
            is_active: Set(true),
            last_login_at: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };
        
        user.insert(db).await
    }
    
    /// 更新用户
    pub async fn update(
        db: &DatabaseConnection,
        id: i64,
        display_name: Option<String>,
        email: Option<String>,
        role: Option<String>,
        is_active: Option<bool>,
    ) -> Result<app_user::Model, DbErr> {
        let user = app_user::Entity::find_by_id(id)
            .one(db)
            .await?
            .ok_or(DbErr::RecordNotFound(format!("User {} not found", id)))?;
        
        let mut active_user: app_user::ActiveModel = user.into();
        
        if let Some(name) = display_name {
            active_user.display_name = Set(Some(name));
        }
        if let Some(email_val) = email {
            active_user.email = Set(Some(email_val));
        }
        if let Some(role_val) = role {
            active_user.role = Set(role_val);
        }
        if let Some(active) = is_active {
            active_user.is_active = Set(active);
        }
        active_user.updated_at = Set(chrono::Utc::now().naive_utc());
        
        active_user.update(db).await
    }
    
    /// 更新密码
    pub async fn update_password(
        db: &DatabaseConnection,
        id: i64,
        new_password_hash: String,
    ) -> Result<app_user::Model, DbErr> {
        let user = app_user::Entity::find_by_id(id)
            .one(db)
            .await?
            .ok_or(DbErr::RecordNotFound(format!("User {} not found", id)))?;
        
        let mut active_user: app_user::ActiveModel = user.into();
        active_user.password_hash = Set(new_password_hash);
        active_user.updated_at = Set(chrono::Utc::now().naive_utc());
        
        active_user.update(db).await
    }
    
    /// 更新最后登录时间
    pub async fn update_last_login(
        db: &DatabaseConnection,
        id: i64,
    ) -> Result<(), DbErr> {
        let user = app_user::Entity::find_by_id(id)
            .one(db)
            .await?
            .ok_or(DbErr::RecordNotFound(format!("User {} not found", id)))?;
        
        let mut active_user: app_user::ActiveModel = user.into();
        active_user.last_login_at = Set(Some(chrono::Utc::now().naive_utc()));
        active_user.updated_at = Set(chrono::Utc::now().naive_utc());
        
        active_user.update(db).await?;
        Ok(())
    }
    
    /// 删除用户
    pub async fn delete(db: &DatabaseConnection, id: i64) -> Result<(), DbErr> {
        app_user::Entity::delete_by_id(id)
            .exec(db)
            .await?;
        Ok(())
    }
}

/// 用户会话 Repository
pub struct SessionRepo;

impl SessionRepo {
    /// 根据 Token 查找会话
    pub async fn find_by_token(
        db: &DatabaseConnection,
        token: &str,
    ) -> Result<Option<app_user_session::Model>, DbErr> {
        app_user_session::Entity::find()
            .filter(app_user_session::Column::Token.eq(token))
            .filter(app_user_session::Column::ExpiresAt.gt(chrono::Utc::now().naive_utc()))
            .one(db)
            .await
    }
    
    /// 创建会话
    pub async fn create(
        db: &DatabaseConnection,
        user_id: i64,
        token: String,
        ip_address: Option<String>,
        user_agent: Option<String>,
        expires_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<app_user_session::Model, DbErr> {
        let session = app_user_session::ActiveModel {
            user_id: Set(user_id),
            token: Set(token),
            ip_address: Set(ip_address),
            user_agent: Set(user_agent),
            expires_at: Set(expires_at.naive_utc()),
            created_at: Set(chrono::Utc::now().naive_utc()),
            ..Default::default()
        };
        
        session.insert(db).await
    }
    
    /// 删除会话（登出）
    pub async fn delete_by_token(
        db: &DatabaseConnection,
        token: &str,
    ) -> Result<(), DbErr> {
        app_user_session::Entity::delete_many()
            .filter(app_user_session::Column::Token.eq(token))
            .exec(db)
            .await?;
        Ok(())
    }
    
    /// 删除用户的所有会话
    pub async fn delete_by_user_id(
        db: &DatabaseConnection,
        user_id: i64,
    ) -> Result<(), DbErr> {
        app_user_session::Entity::delete_many()
            .filter(app_user_session::Column::UserId.eq(user_id))
            .exec(db)
            .await?;
        Ok(())
    }
    
    /// 清理过期会话
    pub async fn cleanup_expired(db: &DatabaseConnection) -> Result<u64, DbErr> {
        let result = app_user_session::Entity::delete_many()
            .filter(app_user_session::Column::ExpiresAt.lt(chrono::Utc::now().naive_utc()))
            .exec(db)
            .await?;
        Ok(result.rows_affected)
    }
}

/// API Token Repository
pub struct ApiTokenRepo;

impl ApiTokenRepo {
    /// 根据 Token 查找
    pub async fn find_by_token(
        db: &DatabaseConnection,
        token: &str,
    ) -> Result<Option<app_user_api_token::Model>, DbErr> {
        app_user_api_token::Entity::find()
            .filter(app_user_api_token::Column::Token.eq(token))
            .filter(app_user_api_token::Column::IsActive.eq(true))
            .one(db)
            .await
    }
    
    /// 根据用户 ID 查找所有 Token
    pub async fn find_by_user_id(
        db: &DatabaseConnection,
        user_id: i64,
    ) -> Result<Vec<app_user_api_token::Model>, DbErr> {
        app_user_api_token::Entity::find()
            .filter(app_user_api_token::Column::UserId.eq(user_id))
            .order_by_desc(app_user_api_token::Column::CreatedAt)
            .all(db)
            .await
    }
    
    /// 创建 API Token
    pub async fn create(
        db: &DatabaseConnection,
        user_id: i64,
        name: String,
        token: String,
        scopes: Option<String>,
        expires_at: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Result<app_user_api_token::Model, DbErr> {
        let now = chrono::Utc::now().naive_utc();
        
        let api_token = app_user_api_token::ActiveModel {
            user_id: Set(user_id),
            name: Set(name),
            token: Set(token),
            scopes: Set(scopes),
            last_used_at: Set(None),
            expires_at: Set(expires_at.map(|e| e.naive_utc())),
            is_active: Set(true),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };
        
        api_token.insert(db).await
    }
    
    /// 更新最后使用时间
    pub async fn update_last_used(
        db: &DatabaseConnection,
        id: i64,
    ) -> Result<(), DbErr> {
        let token = app_user_api_token::Entity::find_by_id(id)
            .one(db)
            .await?
            .ok_or(DbErr::RecordNotFound(format!("API Token {} not found", id)))?;
        
        let mut active_token: app_user_api_token::ActiveModel = token.into();
        active_token.last_used_at = Set(Some(chrono::Utc::now().naive_utc()));
        active_token.updated_at = Set(chrono::Utc::now().naive_utc());
        
        active_token.update(db).await?;
        Ok(())
    }
    
    /// 删除 API Token
    pub async fn delete(db: &DatabaseConnection, id: i64) -> Result<(), DbErr> {
        app_user_api_token::Entity::delete_by_id(id)
            .exec(db)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    // 注意：这些测试需要真实数据库，标记为 #[ignore]
    #[tokio::test]
    #[ignore]
    async fn test_user_repo_crud() {
        // 需要数据库连接，跳过
    }
}
