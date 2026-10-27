use sea_orm::entity::prelude::*;

/// dandanplay 单集实体。上游集号按字符串保存，支持 SP/OVA 等编号。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "episodes")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    #[sea_orm(indexed)]
    pub anime_id: i64,
    #[sea_orm(indexed, nullable)]
    pub season_id: Option<i64>,
    #[sea_orm(unique, indexed)]
    pub upstream_episode_id: String,
    #[sea_orm(nullable)]
    pub episode_number: Option<String>,
    #[sea_orm(nullable)]
    pub title: Option<String>,
    #[sea_orm(nullable)]
    pub type_description: Option<String>,
    #[sea_orm(nullable)]
    pub duration_seconds: Option<i32>,
    #[sea_orm(nullable)]
    pub air_date: Option<String>,
    pub source_cache_key: String,
    pub first_seen_at: DateTime,
    #[sea_orm(indexed)]
    pub last_seen_at: DateTime,
    pub created_at: DateTime,
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
