use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// 签名密钥池
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "sign_key_pool")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    
    /// 密钥名称
    pub name: String,
    
    /// 签名密钥
    pub sign_key: String,
    
    /// 密钥用途
    pub purpose: String,
    
    /// 是否启用
    pub is_active: bool,
    
    /// 最后使用时间
    pub last_used_at: Option<DateTime>,
    
    /// 创建时间
    pub created_at: DateTime,
    
    /// 更新时间
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
