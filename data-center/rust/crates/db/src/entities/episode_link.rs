use sea_orm::entity::prelude::*;

/// 集数链接表：本地媒体与 dandanplay episode 的稳定链接
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "episode_links")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    
    /// 本地标题
    pub local_title: String,
    
    /// 季号
    pub season_number: Option<i32>,
    
    /// 集号
    pub episode_number: Option<String>,
    
    /// 集标题
    pub episode_title: Option<String>,
    
    /// 文件名哈希
    pub file_name_hash: Option<String>,
    
    /// dandanplay anime ID
    #[sea_orm(indexed)]
    pub dandan_anime_id: Option<String>,
    
    /// dandanplay bangumi ID
    #[sea_orm(indexed)]
    pub dandan_bangumi_id: Option<String>,
    
    /// dandanplay episode ID
    #[sea_orm(indexed)]
    pub dandan_episode_id: String,
    
    /// anime 标题
    pub anime_title: Option<String>,
    
    /// 匹配来源（search_anime/search_episodes/bangumi/match/manual）
    #[sea_orm(indexed)]
    pub match_source: String,
    
    /// 置信度
    pub confidence: i32,
    
    /// 源缓存键
    pub source_cache_key: String,
    
    /// bangumi 缓存键
    pub bangumi_cache_key: Option<String>,
    
    /// 弹幕 API 路径
    pub comment_api_path: Option<String>,
    
    /// 弹幕缓存键
    pub comment_cache_key: Option<String>,
    
    /// 是否手动链接
    pub is_manual: bool,
    
    /// 验证用户 ID
    pub verified_by_user_id: Option<i32>,
    
    /// 最后使用时间
    #[sea_orm(indexed)]
    pub last_used_at: Option<DateTime>,
    
    /// 创建时间
    pub created_at: DateTime,
    
    /// 更新时间
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

