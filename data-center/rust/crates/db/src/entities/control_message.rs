use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// control_messages 表实体
/// 对应 Python models_v2/control.py 的 ControlMessage
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "control_messages")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    
    #[sea_orm(unique, indexed)]
    pub message_id: String,
    
    #[sea_orm(indexed, nullable)]
    pub node_id: Option<String>,
    
    #[sea_orm(indexed)]
    pub direction: String,  // worker_to_local / local_to_worker
    
    #[sea_orm(indexed)]
    pub message_type: String,  // cache.get / cache.upsert 等
    
    #[sea_orm(indexed)]
    pub status: String,  // pending / success / failed / timeout
    
    #[sea_orm(indexed, nullable)]
    pub request_cache_key: Option<String>,
    
    #[sea_orm(nullable)]
    pub payload_summary: Option<String>,
    
    #[sea_orm(nullable)]
    pub error_message: Option<String>,
    
    pub duration_ms: i32,
    
    #[sea_orm(indexed)]  // 复合索引 (created_at, id)
    pub created_at: DateTime,
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
