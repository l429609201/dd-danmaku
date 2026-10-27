use sea_orm::entity::prelude::*;

/// 番剧别名：归一化键用于匹配，source/status 保留审核语义。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "anime_aliases")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    #[sea_orm(indexed)]
    pub anime_id: i64,
    pub alias: String,
    #[sea_orm(indexed)]
    pub alias_norm: String,
    #[sea_orm(nullable)]
    pub alias_norm_ns: Option<String>,
    #[sea_orm(nullable)]
    pub lang: Option<String>,
    #[sea_orm(nullable)]
    pub title_type: Option<String>,
    pub source: String,
    pub status: String,
    pub confidence: i32,
    pub hit_snapshot: i32,
    #[sea_orm(nullable)]
    pub verified_by: Option<i32>,
    #[sea_orm(column_type = "Json", nullable)]
    pub ai_suggestion: Option<serde_json::Value>,
    #[sea_orm(nullable)]
    pub ai_called_at: Option<DateTime>,
    pub created_at: DateTime,
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
