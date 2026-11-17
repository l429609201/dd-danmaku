use sea_orm::entity::prelude::*;

/// 搜索响应的候选身份及顺序，字段仍由主档/集表提供。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "catalog_search_members")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub request_key: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub ordinal: i64,
    pub anime_id: i64,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
