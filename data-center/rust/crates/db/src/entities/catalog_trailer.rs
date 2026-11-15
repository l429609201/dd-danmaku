use sea_orm::entity::prelude::*;

/// 官方目录固定类型字段；位图仅记录字段存在性，不保存任意 JSON。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "catalog_trailers")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub upstream_anime_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub ordinal: i64,
    pub present: i64,
    pub trailer_id: Option<i32>,
    pub url: Option<String>,
    pub title: Option<String>,
    pub image_url: Option<String>,
    pub date: Option<String>,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
