use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// 应用用户（管理后台用户）
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "app_users")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    
    /// 用户名（唯一）
    #[sea_orm(unique)]
    pub username: String,
    
    /// 密码哈希（bcrypt）
    pub password_hash: String,
    
    /// 显示名称
    pub display_name: Option<String>,
    
    /// 邮箱
    pub email: Option<String>,
    
    /// 角色：admin, user
    pub role: String,
    
    /// 是否激活
    pub is_active: bool,
    
    /// 最后登录时间
    pub last_login_at: Option<DateTime>,
    
    /// 创建时间
    pub created_at: DateTime,
    
    /// 更新时间
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::app_user_session::Entity")]
    Sessions,
    
    #[sea_orm(has_many = "super::app_user_api_token::Entity")]
    ApiTokens,
}

impl Related<super::app_user_session::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Sessions.def()
    }
}

impl Related<super::app_user_api_token::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::ApiTokens.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_app_user_model() {
        let user = Model {
            id: 1,
            username: "admin".to_string(),
            password_hash: "$2b$12$...".to_string(),
            display_name: Some("管理员".to_string()),
            email: Some("admin@example.com".to_string()),
            role: "admin".to_string(),
            is_active: true,
            last_login_at: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        
        assert_eq!(user.username, "admin");
        assert_eq!(user.role, "admin");
        assert!(user.is_active);
    }
}
