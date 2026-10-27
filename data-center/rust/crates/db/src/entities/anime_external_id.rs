use sea_orm::entity::prelude::*;

/// 可扩展的番剧外部平台标识。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "anime_external_ids")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    #[sea_orm(indexed)]
    pub anime_id: i64,
    pub provider: String,
    #[sea_orm(nullable)]
    pub external_id: Option<String>,
    #[sea_orm(nullable)]
    pub external_url: Option<String>,
    pub source: String,
    pub confidence: i32,
    pub created_at: DateTime,
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
