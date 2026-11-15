use sea_orm::entity::prelude::*;

/// 官方 p 按时间、模式、颜色、用户 ID 拆列；响应从业务字段组装。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "structured_comments")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub request_key: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub ordinal: i64,
    pub present_fields: i64,
    pub cid: i64,
    pub p_is_null: bool,
    pub time_seconds: Option<f64>,
    pub mode: Option<i32>,
    pub color: Option<i64>,
    pub user_id: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub m: Option<String>,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
