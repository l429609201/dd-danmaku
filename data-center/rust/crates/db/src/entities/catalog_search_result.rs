use sea_orm::entity::prelude::*;

/// 精确搜索请求的分页元数据，不存储响应正文。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "catalog_search_results")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub request_key: String,
    pub has_more: bool,
    pub candidate_count: i64,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
