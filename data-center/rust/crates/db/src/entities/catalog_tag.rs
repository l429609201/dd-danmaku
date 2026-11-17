use sea_orm::entity::prelude::*;

/// 官方目录固定类型字段；位图仅记录字段存在性，不保存任意 JSON。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "catalog_tags")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub upstream_anime_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub ordinal: i64,
    pub present: i64,
    pub tag_id: Option<i32>,
    pub name: Option<String>,
    pub count: Option<i32>,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
