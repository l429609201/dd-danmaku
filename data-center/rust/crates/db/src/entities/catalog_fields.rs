use sea_orm::entity::prelude::*;

/// 官方目录固定类型字段；位图仅记录字段存在性，不保存任意 JSON。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "catalog_fields")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub upstream_anime_id: String,
    pub present: i64,
    pub null_collections: i64,
    pub bangumi_id: Option<String>,
    pub search_keyword: Option<String>,
    pub is_on_air: Option<bool>,
    pub air_day: Option<i32>,
    pub is_favorited: Option<bool>,
    pub is_restricted: Option<bool>,
    pub intro: Option<String>,
    pub user_rating: Option<i32>,
    pub favorite_status: Option<String>,
    pub comment: Option<String>,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
