use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// 用户 API Token（用于外部调用）
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "app_user_api_tokens")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    
    /// 关联用户 ID
    pub user_id: i64,
    
    /// Token 名称（用户自定义）
    pub name: String,
    
    /// API Token（随机生成）
    #[sea_orm(unique)]
    pub token: String,
    
    /// 权限范围（JSON 数组）
    pub scopes: Option<String>,
    
    /// 最后使用时间
    pub last_used_at: Option<DateTime>,
    
    /// 过期时间（可选，永不过期为 null）
    pub expires_at: Option<DateTime>,
    
    /// 是否激活
    pub is_active: bool,
    
    /// 创建时间
    pub created_at: DateTime,
    
    /// 更新时间
    pub updated_at: DateTime,
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
    fn test_app_user_api_token_model() {
        let token = Model {
            id: 1,
            user_id: 1,
            name: "API Key 1".to_string(),
            token: "sk_...".to_string(),
            scopes: Some(r#"["read", "write"]"#.to_string()),
            last_used_at: None,
            expires_at: None,
            is_active: true,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        
        assert_eq!(token.name, "API Key 1");
        assert!(token.is_active);
        assert!(token.expires_at.is_none());
    }
}
