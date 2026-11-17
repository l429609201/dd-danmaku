use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// 用户白名单
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "user_allow_pool")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    
    /// 用户标识（用户名、邮箱或其他唯一标识）
    pub user_identifier: String,
    
    /// 用户类型
    pub user_type: String,
    
    /// 描述
    pub description: Option<String>,
    
    /// 是否启用
    pub is_active: bool,
    
    /// 创建时间
    pub created_at: DateTime,
    
    /// 更新时间
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
