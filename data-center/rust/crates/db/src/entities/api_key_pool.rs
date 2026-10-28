use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// API 密钥池
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "api_key_pool")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    
    /// 密钥名称
    pub name: String,
    
    /// API 密钥（加密存储）
    pub api_key: String,
    
    /// 密钥来源/用途
    pub source: String,
    
    /// 是否启用
    pub is_active: bool,
    
    /// 优先级
    pub priority: i32,
    
    /// 最后使用时间
    pub last_used_at: Option<DateTime>,
    
    /// 使用次数
    pub use_count: i64,
    
    /// 创建时间
    pub created_at: DateTime,
    
    /// 更新时间
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
