use sea_orm::entity::prelude::*;

/// 未识别旧表逐行保留的安全隔离记录；值以 JSON 存储，secret 列只存掩码摘要。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "legacy_import_rows")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    #[sea_orm(indexed)]
    pub run_id: String,
    #[sea_orm(indexed)]
    pub source_table: String,
    pub source_key: String,
    #[sea_orm(column_type = "Json")]
    pub row_json: serde_json::Value,
    pub row_checksum: String,
    pub created_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
