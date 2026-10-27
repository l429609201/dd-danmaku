use sea_orm::entity::prelude::*;

/// 响应实体索引表：anime/bangumi/episode 拆分索引
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "api_response_entities")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    
    /// 实体类型（anime/bangumi/episode）
    #[sea_orm(indexed)]
    pub entity_type: String,
    
    /// 实体 ID
    #[sea_orm(indexed)]
    pub entity_id: String,
    
    /// 标题
    pub title: Option<String>,
    
    /// 集标题
    pub episode_title: Option<String>,
    
    /// 所属番剧 ID
    pub anime_id: Option<String>,
    
    /// 集号（字符串，可能是 "7" / "SP1" / "OVA"）
    pub episode_number: Option<String>,
    
    /// API 路径
    pub api_path: String,
    
    /// 缓存键
    pub cache_key: String,
    
    /// 原始 JSON
    pub raw_json: Option<Json>,
    
    /// 首次发现时间
    pub first_seen_at: DateTime,
    
    /// 最后发现时间
    #[sea_orm(indexed)]
    pub last_seen_at: DateTime,
    
    /// 创建时间
    pub created_at: DateTime,
    
    /// 更新时间
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

