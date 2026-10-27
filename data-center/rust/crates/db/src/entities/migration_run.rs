use sea_orm::entity::prelude::*;

/// 一次迁移执行的安全状态与源身份摘要；不得存储连接串或凭据。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "migration_runs")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, unique)]
    pub run_id: String,
    pub source_identity_hash: String,
    pub target_identity_hash: String,
    pub status: String,
    pub started_at: DateTime,
    #[sea_orm(nullable)]
    pub finished_at: Option<DateTime>,
    pub created_at: DateTime,
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
