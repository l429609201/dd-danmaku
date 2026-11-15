use sea_orm::entity::prelude::*;

/// 官方 seasons[]，季度标识与作品 bangumiId 独立。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "bangumi_seasons")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub upstream_bangumi_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub ordinal: i64,
    pub upstream_season_id: Option<String>,
    pub name: Option<String>,
    pub air_date: Option<String>,
    pub episode_count: i32,
    #[sea_orm(column_type = "Text", nullable)]
    pub summary: Option<String>,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
