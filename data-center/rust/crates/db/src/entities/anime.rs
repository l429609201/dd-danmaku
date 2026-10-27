use sea_orm::entity::prelude::*;

/// dandanplay 番剧主档，不承担原始响应缓存职责。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "animes")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    #[sea_orm(unique, indexed)]
    pub upstream_anime_id: String,
    #[sea_orm(nullable)]
    pub title: Option<String>,
    #[sea_orm(nullable)]
    pub image_url: Option<String>,
    #[sea_orm(nullable)]
    pub type_code: Option<String>,
    #[sea_orm(nullable)]
    pub type_description: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub summary: Option<String>,
    #[sea_orm(nullable)]
    pub rating: Option<String>,
    #[sea_orm(nullable)]
    pub start_date: Option<String>,
    pub episode_count: i32,
    pub source: String,
    pub first_seen_at: DateTime,
    #[sea_orm(indexed)]
    pub last_seen_at: DateTime,
    pub created_at: DateTime,
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
