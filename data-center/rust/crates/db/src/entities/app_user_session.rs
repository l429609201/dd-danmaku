use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// 用户会话（登录会话）
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "app_user_sessions")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    
    /// 关联用户 ID
    pub user_id: i64,
    
    /// Session Token（JWT）
    #[sea_orm(unique)]
    pub token: String,
    
    /// IP 地址
    pub ip_address: Option<String>,
    
    /// User Agent
    pub user_agent: Option<String>,
    
    /// 过期时间
    pub expires_at: DateTime,
    
    /// 创建时间
    pub created_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::app_user::Entity",
        from = "Column::UserId",
        to = "super::app_user::Column::Id"
    )]
    User,
}

impl Related<super::app_user::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::User.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_app_user_session_model() {
        let session = Model {
            id: 1,
            user_id: 1,
            token: "eyJ...".to_string(),
            ip_address: Some("127.0.0.1".to_string()),
            user_agent: Some("Mozilla/5.0".to_string()),
            expires_at: chrono::Utc::now() + chrono::Duration::hours(24),
            created_at: chrono::Utc::now(),
        };
        
        assert_eq!(session.user_id, 1);
        assert!(session.token.starts_with("eyJ"));
    }
}
