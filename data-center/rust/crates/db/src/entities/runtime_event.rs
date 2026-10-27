use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// runtime_events 表实体
/// 对应 Python models_v2/control.py 的 RuntimeEvent
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "runtime_events")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    
    #[sea_orm(indexed)]
    pub level: String,  // INFO / WARN / ERROR
    
    #[sea_orm(indexed)]
    pub category: String,  // control / cache / config / system
    
    #[sea_orm(indexed)]
    pub event: String,
    
    pub message: String,
    
    #[sea_orm(column_type = "Json", nullable)]
    pub details_json: Option<serde_json::Value>,
    
    #[sea_orm(indexed)]
    pub created_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
