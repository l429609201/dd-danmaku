use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// control_nodes 表实体
/// 对应 Python models_v2/control.py 的 ControlNode
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "control_nodes")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    
    #[sea_orm(unique, indexed)]
    pub node_id: String,
    
    #[sea_orm(indexed)]
    pub worker_id: String,
    
    pub worker_url: String,
    
    pub connected: bool,
    
    #[sea_orm(nullable)]
    pub connection_id: Option<String>,
    
    pub protocol_version: String,
    
    #[sea_orm(nullable)]
    pub client_version: Option<String>,
    
    #[sea_orm(nullable)]
    pub last_connected_at: Option<DateTime>,
    
    #[sea_orm(indexed, nullable)]
    pub last_seen_at: Option<DateTime>,
    
    pub latency_ms: i32,
    
    pub reconnect_count: i32,
    
    #[sea_orm(nullable)]
    pub last_error: Option<String>,
    
    #[sea_orm(column_type = "Json", nullable)]
    pub extra_json: Option<serde_json::Value>,
    
    pub created_at: DateTime,
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
