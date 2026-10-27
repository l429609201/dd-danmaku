use sea_orm::entity::prelude::*;

/// 番剧季/版本实体；bangumi 与 anime 分开，避免覆盖同一番剧的多个版本。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "seasons")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    #[sea_orm(indexed)]
    pub anime_id: i64,
    #[sea_orm(nullable)]
    pub upstream_bangumi_id: Option<String>,
    #[sea_orm(nullable)]
    pub title: Option<String>,
    #[sea_orm(nullable)]
    pub season_number: Option<i32>,
    #[sea_orm(column_type = "Text", nullable)]
    pub summary: Option<String>,
    #[sea_orm(nullable)]
    pub raw_entity_id: Option<i64>,
    pub created_at: DateTime,
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
