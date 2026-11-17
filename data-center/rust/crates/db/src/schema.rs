use sea_orm::{
    ConnectionTrait, DatabaseConnection, DbBackend, DbErr, EntityTrait, QuerySelect, QueryTrait,
    Statement,
};
use sea_orm::sea_query::{
    Index, MysqlQueryBuilder, PostgresQueryBuilder, SqliteQueryBuilder, TableCreateStatement,
};

use crate::entities::{
    anime, anime_alias, anime_external_id, api_key_pool, api_response_cache, api_response_entity,
    app_user, app_user_api_token, app_user_session, cleanup_policy, config, config_secret,
    control_message, control_node, episode, episode_link, ip_rule, ip_stats, legacy_import_row,
    local_comment_store, migration_run, migration_table, oauth_config, runtime_event, season,
    sign_key_pool, ua_rule, user_allow_pool, worker_log,
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
    // IF NOT EXISTS 不会修复同名旧表；零行查询只校验 Rust 所需列可访问，不迁移数据或类型。
    for (table, statement) in [
        ("ip_rules", ip_rule::Entity::find().limit(0).build(backend)),
        ("ua_rules", ua_rule::Entity::find().limit(0).build(backend)),
        ("api_key_pool", api_key_pool::Entity::find().limit(0).build(backend)),
        ("sign_key_pool", sign_key_pool::Entity::find().limit(0).build(backend)),
        ("user_allow_pool", user_allow_pool::Entity::find().limit(0).build(backend)),
        ("oauth_config", oauth_config::Entity::find().limit(0).build(backend)),
        ("worker_logs", worker_log::Entity::find().limit(0).build(backend)),
        ("ip_stats", ip_stats::Entity::find().limit(0).build(backend)),
        ("cleanup_policies", cleanup_policy::Entity::find().limit(0).build(backend)),
    ] {
        db.query_all(statement)
            .await
            .map_err(|source| SchemaError::Database(DbErr::Custom(format!(
                "表 {table} 与 Rust 实体字段不兼容，未修改旧表；请显式检查源库 schema: {source}"
            ))))?;
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
        // 新协议表仅 CREATE IF NOT EXISTS，不回填或改写已有生产数据。
        schema.create_table_from_entity(crate::entities::structured_response::Entity),
        schema.create_table_from_entity(crate::entities::structured_match::Entity),
        schema.create_table_from_entity(crate::entities::structured_comment::Entity),
        with_unique_index(
            schema.create_table_from_entity(anime::Entity),
            "uq_anime_upstream_id",
            &["upstream_anime_id"],
        ),
        schema.create_table_from_entity(season::Entity),
        // 详情字段新增独立表，旧库也可安全 CREATE IF NOT EXISTS。
        schema.create_table_from_entity(crate::entities::bangumi_version::Entity),
        schema.create_table_from_entity(crate::entities::bangumi_season::Entity),
        schema.create_table_from_entity(crate::entities::bangumi_episode_member::Entity),
        schema.create_table_from_entity(crate::entities::bangumi_title::Entity),
        schema.create_table_from_entity(crate::entities::catalog_search_result::Entity),
        schema.create_table_from_entity(crate::entities::catalog_search_member::Entity),
        // 官方目录扩展字段使用新类型表，不 ALTER 已有生产表。
        schema.create_table_from_entity(crate::entities::catalog_fields::Entity),
        schema.create_table_from_entity(crate::entities::catalog_metadata::Entity),
        schema.create_table_from_entity(crate::entities::catalog_rating_detail::Entity),
        schema.create_table_from_entity(crate::entities::catalog_relation::Entity),
        schema.create_table_from_entity(crate::entities::catalog_tag::Entity),
        schema.create_table_from_entity(crate::entities::catalog_trailer::Entity),
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
        // 管理路由所需表使用 Rust 实体字段；不复用 Python 旧表的字段或额外唯一约束。
        schema.create_table_from_entity(ip_rule::Entity),
        schema.create_table_from_entity(ua_rule::Entity),
        schema.create_table_from_entity(api_key_pool::Entity),
        schema.create_table_from_entity(sign_key_pool::Entity),
        // 仓储按标识/提供商取单条，唯一性与这两个查找键保持一致。
        with_unique_index(
            schema.create_table_from_entity(user_allow_pool::Entity),
            "uq_user_allow_pool_identifier",
            &["user_identifier"],
        ),
        with_unique_index(
            schema.create_table_from_entity(oauth_config::Entity),
            "uq_oauth_config_provider",
            &["provider"],
        ),
        schema.create_table_from_entity(worker_log::Entity),
        schema.create_table_from_entity(ip_stats::Entity),
        schema.create_table_from_entity(cleanup_policy::Entity),
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
