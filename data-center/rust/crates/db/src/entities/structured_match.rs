use sea_orm::entity::prelude::*;

/// 匹配候选按请求与原始顺序存储，避免不同文件或参数之间串用。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "structured_matches")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub request_key: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub ordinal: i64,
    pub present_fields: i64,
    pub anime_id: Option<i64>,
    pub episode_id: Option<i64>,
    #[sea_orm(column_type = "Text", nullable)]
    pub anime_title: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub episode_title: Option<String>,
    pub anime_type: Option<String>,
    pub type_description: Option<String>,
    pub shift: Option<f64>,
    #[sea_orm(column_type = "Text", nullable)]
    pub image_url: Option<String>,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
