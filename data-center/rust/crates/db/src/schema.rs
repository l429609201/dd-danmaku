use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, DbErr, Statement};
use sea_orm::sea_query::{
    Index, MysqlQueryBuilder, PostgresQueryBuilder, SqliteQueryBuilder, TableCreateStatement,
};

use crate::entities::{
    anime, anime_alias, anime_external_id, api_response_cache, api_response_entity,
    app_user, app_user_api_token, app_user_session, config, config_secret, control_message,
    control_node, episode, episode_link, legacy_import_row, local_comment_store, migration_run, 
    migration_table, runtime_event, season,
};

/// 目标 schema 初始化错误；DDL 使用 SeaORM/SeaQuery 生成，避免拼接用户输入标识符。
#[derive(Debug, thiserror::Error)]
pub enum SchemaError {
    #[error("数据库执行失败: {0}")]
    Database(#[from] DbErr),
}

/// 初始化规范化业务表、保留层和迁移账本。
///
/// 该函数只创建不存在的表，适用于空目标库或显式初始化阶段；不会修改旧源库。
pub async fn ensure_schema(db: &DatabaseConnection) -> Result<(), SchemaError> {
    let backend = db.get_database_backend();
    for sql in schema_statements(backend) {
        db.execute(Statement::from_string(backend, sql)).await?;
    }
    Ok(())
}

/// 返回确定性的建表 SQL；使用固定实体列表而非动态表名。
pub fn schema_statements(backend: DbBackend) -> Vec<String> {
    let schema = sea_orm::Schema::new(backend);
    let tables = vec![
        schema.create_table_from_entity(control_node::Entity),
        schema.create_table_from_entity(control_message::Entity),
        schema.create_table_from_entity(runtime_event::Entity),
        schema.create_table_from_entity(api_response_cache::Entity),
        schema.create_table_from_entity(api_response_entity::Entity),
        schema.create_table_from_entity(episode_link::Entity),
        with_unique_index(
            schema.create_table_from_entity(anime::Entity),
            "uq_anime_upstream_id",
            &["upstream_anime_id"],
        ),
        schema.create_table_from_entity(season::Entity),
        with_unique_index(
            schema.create_table_from_entity(episode::Entity),
            "uq_episode_upstream_id",
            &["upstream_episode_id"],
        ),
        with_unique_index(
            schema.create_table_from_entity(anime_external_id::Entity),
            "uq_external_anime_provider",
            &["anime_id", "provider"],
        ),
        with_unique_index(
            schema.create_table_from_entity(anime_alias::Entity),
            "uq_alias_anime_norm",
            &["anime_id", "alias_norm"],
        ),
        with_unique_index(
            schema.create_table_from_entity(config::Entity),
            "uq_configs_namespace_key",
            &["namespace", "config_key"],
        ),
        schema.create_table_from_entity(config_secret::Entity),
        with_unique_index(
            schema.create_table_from_entity(app_user::Entity),
            "uq_app_user_username",
            &["username"],
        ),
        schema.create_table_from_entity(app_user_session::Entity),
        schema.create_table_from_entity(app_user_api_token::Entity),
        with_unique_index(
            schema.create_table_from_entity(migration_run::Entity),
            "uq_migration_run_id",
            &["run_id"],
        ),
        with_unique_index(
            schema.create_table_from_entity(migration_table::Entity),
            "uq_migration_run_table",
            &["run_id", "source_table"],
        ),
        schema.create_table_from_entity(legacy_import_row::Entity),
        with_unique_index(
            schema.create_table_from_entity(local_comment_store::Entity),
            "uq_comment_store_episode",
            &["episode_id"],
        ),
    ];

    tables
        .into_iter()
        .map(|mut table| {
            table.if_not_exists();
            match backend {
                DbBackend::MySql => table.to_string(MysqlQueryBuilder),
                DbBackend::Postgres => table.to_string(PostgresQueryBuilder),
                DbBackend::Sqlite => table.to_string(SqliteQueryBuilder),
            }
        })
        .collect()
}

fn with_unique_index(
    mut table: TableCreateStatement,
    name: &str,
    columns: &[&str],
) -> TableCreateStatement {
    let mut index = Index::create();
    index.unique().name(name);
    for column in columns {
        index.col(sea_orm::sea_query::Alias::new(*column));
    }
    table.index(&mut index);
    table
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_contains_normalized_and_ledger_tables() {
        let sql = schema_statements(DbBackend::Postgres).join("\n");
        assert!(sql.contains("CREATE TABLE IF NOT EXISTS \"animes\""));
        assert!(sql.contains("CREATE TABLE IF NOT EXISTS \"migration_runs\""));
        assert!(sql.contains("uq_migration_run_table"));
        assert!(sql.contains("uq_configs_namespace_key"));
        assert!(!sql.contains("mysql://"));
    }

    #[test]
    fn schema_is_dialect_aware() {
        let mysql = schema_statements(DbBackend::MySql).join("\n");
        let postgres = schema_statements(DbBackend::Postgres).join("\n");
        assert!(mysql.contains('`'));
        assert!(postgres.contains('"'));
        assert_ne!(mysql, postgres);
    }
}
