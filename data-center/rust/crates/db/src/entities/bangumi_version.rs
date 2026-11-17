use sea_orm::entity::prelude::*;

/// 官方详情版本及完整剧集列表的数量证据；不保存响应 JSON。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "bangumi_versions")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub upstream_bangumi_id: String,
    pub anime_id: i64,
    pub expected_episode_count: i64,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
