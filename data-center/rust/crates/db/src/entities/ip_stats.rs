use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// IP 统计
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "ip_stats")]
pub struct Model {
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
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
