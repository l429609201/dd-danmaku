use sea_orm::entity::prelude::*;

/// 标题原文及语言原文，避免将未知语言改造成猜测的标签。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "bangumi_titles")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub upstream_bangumi_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub ordinal: i64,
    pub title: Option<String>,
    pub language: Option<String>,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
