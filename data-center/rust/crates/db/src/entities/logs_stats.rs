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

/// IP 统计
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "ip_stats")]
pub struct IpStatsModel {
    #[sea_orm(primary_key)]
    pub id: i64,
    
    /// IP 地址
    pub ip_address: String,
    
    /// 请求路径
    pub path: String,
    
    /// 请求方法
    pub method: String,
    
    /// 响应状态码
    pub status_code: i32,
    
    /// User-Agent
    pub user_agent: Option<String>,
    
    /// 请求时间
    pub request_time: DateTime,
    
    /// 响应时间（毫秒）
    pub response_time_ms: Option<i32>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum IpStatsRelation {}

impl ActiveModelBehavior for IpStatsActiveModel {}
