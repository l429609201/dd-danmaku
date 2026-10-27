use sea_orm::entity::prelude::*;

/// 每张源表的迁移阶段、断点和校验摘要。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "migration_tables")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    #[sea_orm(indexed)]
    pub run_id: String,
    #[sea_orm(unique)]
    pub source_table: String,
    #[sea_orm(indexed)]
    pub target_table: String,
    pub mode: String,
    pub status: String,
    pub rows_read: i64,
    pub rows_written: i64,
    pub last_source_key: Option<String>,
    pub source_checksum: Option<String>,
    pub target_checksum: Option<String>,
    pub error_kind: Option<String>,
    pub created_at: DateTime,
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
