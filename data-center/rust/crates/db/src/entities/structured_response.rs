use sea_orm::entity::prelude::*;

/// 协议响应元数据：只存独立标量，不保存上游 JSON 或请求正文。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "structured_responses")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub request_key: String,
    pub api_path: String,
    pub present_fields: i64,
    pub success: Option<bool>,
    pub error_code: Option<i64>,
    #[sea_orm(column_type = "Text", nullable)]
    pub error_message: Option<String>,
    pub is_matched: Option<bool>,
    pub comment_count: Option<i64>,
    pub expires_at: DateTime,
}
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
impl ActiveModelBehavior for ActiveModel {}
