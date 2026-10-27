use sea_orm::entity::prelude::*;

/// 上游 API 响应缓存主表
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "api_response_cache")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    
    /// 缓存键（唯一索引）
    #[sea_orm(unique, indexed)]
    pub cache_key: String,
    
    /// 数据源（dandanplay 等）
    pub source: String,
    
    /// HTTP 方法
    pub method: String,
    
    /// API 路径
    #[sea_orm(indexed)]
    pub api_path: String,
    
    /// 归一化查询字符串
    pub normalized_query: Option<String>,
    
    /// 查询参数 JSON
    pub query_json: Option<Json>,
    
    /// 请求体哈希
    pub request_body_hash: Option<String>,
    
    /// 请求体 JSON
    pub request_body_json: Option<Json>,
    
    /// 客户端 IP
    pub client_ip: Option<String>,
    
    /// HTTP 状态码
    pub status_code: i32,
    
    /// 响应头 JSON
    pub response_headers_json: Option<Json>,
    
    /// 响应体（SQL 冷备模式）
    #[sea_orm(column_type = "Text", nullable)]
    pub response_body: Option<String>,
    
    /// Redis 键
    pub redis_key: Option<String>,
    
    /// 存储模式（redis/sql）
    pub storage_mode: String,
    
    /// 响应体哈希
    pub body_hash: String,
    
    /// 响应体大小（字节）
    pub body_size: i32,
    
    /// 获取时间
    #[sea_orm(indexed)]
    pub fetched_at: DateTime,
    
    /// 最后使用时间
    pub last_used_at: Option<DateTime>,
    
    /// 最后刷新时间
    pub last_refresh_at: Option<DateTime>,
    
    /// 刷新时间点
    #[sea_orm(indexed)]
    pub refresh_after: DateTime,
    
    /// 过期时间
    #[sea_orm(indexed)]
    pub expire_at: DateTime,
    
    /// 刷新待处理标记
    #[sea_orm(indexed)]
    pub refresh_pending: bool,
    
    /// 命中次数
    pub hit_count: i32,
    
    /// 过期命中次数
    pub stale_hit_count: i32,
    
    /// 上游 429 次数
    pub upstream_429_count: i32,
    
    /// 空结果标记
    #[sea_orm(indexed)]
    pub is_empty: bool,
    
    /// 创建时间
    pub created_at: DateTime,
    
    /// 更新时间
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

