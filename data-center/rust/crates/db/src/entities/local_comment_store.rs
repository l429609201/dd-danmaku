use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// 本地弹幕兜底持久化元数据表
/// 
/// 实际弹幕内容存储在文件系统的 JSON 文件中，
/// 此表只记录文件路径和元数据
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "local_comment_store")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    
    /// episode ID（唯一索引）
    #[sea_orm(unique, indexed)]
    pub episode_id: String,
    
    /// 弹幕 JSON 文件路径（相对或绝对）
    pub file_path: String,
    
    /// 文件大小（字节）
    pub size_bytes: i64,
    
    /// 弹幕条数
    #[sea_orm(indexed)]
    pub comment_count: i32,
    
    /// 来源标识（如 "r2_archive", "dandanplay", "manual"）
    pub source: String,
    
    /// 创建时间
    #[sea_orm(indexed)]
    pub created_at: DateTime,
    
    /// 最后更新时间
    pub updated_at: DateTime,
    
    /// 最后访问时间（用于 LRU 清理）
    pub last_used_at: Option<DateTime>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
