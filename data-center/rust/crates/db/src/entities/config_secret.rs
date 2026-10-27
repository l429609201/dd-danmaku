use sea_orm::entity::prelude::*;

/// 含明文 secret 的旧配置不会复制到新 schema；只留 hash 和来源元数据。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "config_secrets")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    #[sea_orm(indexed)]
    pub namespace: String,
    pub config_key: String,
    pub value_hash: String,
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
