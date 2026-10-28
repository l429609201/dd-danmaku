use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// Worker 日志
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "worker_logs")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    
    /// Worker 节点 ID
    pub node_id: Option<String>,
    
    /// 日志级别
    pub level: String,
    
    /// 日志消息
    pub message: String,
    
    /// 额外数据（JSON）
    pub extra_data: Option<String>,
    
    /// 创建时间
    pub created_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
