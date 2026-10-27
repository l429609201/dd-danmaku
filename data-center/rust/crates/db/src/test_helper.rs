use sea_orm::{DatabaseConnection, DbErr};

/// 测试辅助函数：创建全部业务表、迁移账本与索引。
pub async fn create_test_schema(db: &DatabaseConnection) -> Result<(), DbErr> {
    crate::schema::ensure_schema(db)
        .await
        .map_err(|error| match error {
            crate::schema::SchemaError::Database(db_error) => db_error,
        })
}
