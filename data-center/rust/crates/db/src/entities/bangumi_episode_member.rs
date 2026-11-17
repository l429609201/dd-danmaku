use sea_orm::entity::prelude::*;

/// 官方完整详情的成员清单；顺序与季度归属独立于可编辑的剧集字段。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "bangumi_episode_members")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub upstream_bangumi_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub ordinal: i64,
    pub upstream_episode_id: String,
    pub upstream_season_id: Option<String>,
    pub last_watched: Option<String>,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
