use sea_orm::entity::prelude::*;

/// 将旧配置收敛为 key-value，同时保留来源审计信息。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "configs")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    #[sea_orm(indexed)]
    pub namespace: String,
    pub config_key: String,
    pub value_type: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub value_text: Option<String>,
    pub is_secret: bool,
    #[sea_orm(nullable)]
    pub description: Option<String>,
    #[sea_orm(nullable)]
    pub source_table: Option<String>,
    #[sea_orm(nullable)]
    pub source_column: Option<String>,
    #[sea_orm(nullable)]
    pub source_pk: Option<String>,
    pub created_at: DateTime,
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
