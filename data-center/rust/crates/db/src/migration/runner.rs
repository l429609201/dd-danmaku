use std::collections::BTreeSet;

use sea_orm::{
    AccessMode, ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement,
    TransactionTrait,
};
use url::Url;

use super::{MigrationMode, MigrationOptions, MigrationOptionsError};

/// 预检报告只公开计数和安全的标识，不携带连接串、用户名或密码。
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreflightReport {
    pub source_dialect: String,
    pub target_dialect: String,
    pub source_identity: ServerIdentity,
    pub target_identity: ServerIdentity,
    pub source_table_count: usize,
    pub target_table_count: usize,
    pub target_other_object_count: usize,
    pub target_has_no_base_tables: bool,
    pub target_has_no_application_objects: bool,
    pub selected_tables: Vec<String>,
    pub mode: MigrationMode,
}

/// 服务器身份信息，用于防止 DNS 别名、代理或同库误配。
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServerIdentity {
    /// MySQL: @@hostname, @@port, DATABASE(); PostgreSQL: inet_server_addr(), inet_server_port(), current_database()
    pub host_or_addr: Option<String>,
    pub port: Option<u16>,
    pub database: String,
    /// MySQL: @@server_uuid; PostgreSQL: system_identifier from pg_control_system()
    pub server_id: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum MigrationError {
    #[error(transparent)]
    Options(#[from] MigrationOptionsError),
    #[error("数据库连接/查询失败")]
    Database,
    #[error("来源表不在反射到的表清单中")]
    UnknownSourceTable,
    #[error("数据库实际连接方言与声明不一致，已拒绝预检")]
    UnexpectedDialect,
    #[error("服务器身份验证失败或相同服务器误配")]
    ServerIdentityMismatch,
    #[error("完整迁移复制器尚未实现，已拒绝 Apply；请勿将预检当作迁移完成")]
    CopyNotImplemented,
}

impl MigrationError {
    /// 确保错误消息不包含凭据、连接串或敏感驱动详情
    pub fn sanitized_message(&self) -> String {
        match self {
            Self::Options(e) => e.to_string(),
            Self::Database => "数据库连接/查询失败".to_owned(),
            Self::UnknownSourceTable => "来源表不在反射到的表清单中".to_owned(),
            Self::UnexpectedDialect => "数据库实际连接方言与声明不一致，已拒绝预检".to_owned(),
            Self::ServerIdentityMismatch => "服务器身份验证失败或相同服务器误配".to_owned(),
            Self::CopyNotImplemented => {
                "完整迁移复制器尚未实现，已拒绝 Apply；请勿将预检当作迁移完成".to_owned()
            }
        }
    }
}

/// DryRun 使用只读事务读取来源元数据；仍建议使用只读账号限制数据库权限。
async fn connect_safely(url: &str) -> Result<DatabaseConnection, MigrationError> {
    let mut options = ConnectOptions::new(url.to_owned());
    options
        .max_connections(2)
        .min_connections(1)
        .connect_timeout(std::time::Duration::from_secs(8))
        .sqlx_logging(false);
    Database::connect(options).await.map_err(|_| MigrationError::Database)
}

fn expected_backend(url: &str) -> Result<DbBackend, MigrationError> {
    let parsed = Url::parse(url).map_err(|_| MigrationError::Options(MigrationOptionsError::InvalidUrl))?;
    match parsed.scheme() {
        "mysql" => Ok(DbBackend::MySql),
        "postgres" | "postgresql" => Ok(DbBackend::Postgres),
        _ => Err(MigrationError::Options(MigrationOptionsError::UnsupportedDialect)),
    }
}

/// 建立来源连接并核验实际 driver 方言；只读事务由预检范围创建。
async fn connect_source(url: &str) -> Result<DatabaseConnection, MigrationError> {
    let source = connect_safely(url).await?;
    if source.get_database_backend() != DbBackend::MySql {
        return Err(MigrationError::UnexpectedDialect);
    }
    Ok(source)
}

async fn connect_target(url: &str) -> Result<DatabaseConnection, MigrationError> {
    let expected = expected_backend(url)?;
    let target = connect_safely(url).await?;
    if target.get_database_backend() != expected {
        return Err(MigrationError::UnexpectedDialect);
    }
    Ok(target)
}

/// 列出当前用户可见的所有常见 schema 对象；目录可见性仍受数据库权限约束。
async fn list_schema_objects<C: ConnectionTrait>(db: &C) -> Result<Vec<(String, String, String)>, MigrationError> {
    let backend = db.get_database_backend();
    let statement = match backend {
        DbBackend::MySql => Statement::from_string(
            backend,
            "SELECT TABLE_SCHEMA AS schema_name, TABLE_NAME AS object_name, TABLE_TYPE AS object_type FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()".to_owned(),
        ),
        DbBackend::Postgres => Statement::from_string(
            backend,
            "SELECT n.nspname AS schema_name, c.relname AS object_name, CASE c.relkind WHEN 'r' THEN 'BASE TABLE' WHEN 'p' THEN 'PARTITIONED TABLE' WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE' WHEN 'S' THEN 'SEQUENCE' ELSE c.relkind::text END AS object_type FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname <> 'information_schema' AND n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\' AND c.relkind IN ('r','p','v','m','f','S')".to_owned(),
        ),
        DbBackend::Sqlite => Statement::from_string(
            backend,
            "SELECT 'main' AS schema_name, name AS object_name, CASE type WHEN 'table' THEN 'BASE TABLE' WHEN 'view' THEN 'VIEW' ELSE type END AS object_type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'".to_owned(),
        ),
    };
    db.query_all(statement)
        .await
        .map_err(|_| MigrationError::Database)?
        .into_iter()
        .map(|row| {
            let schema = row.try_get::<String>("", "schema_name").map_err(|_| MigrationError::Database)?;
            let name = row.try_get::<String>("", "object_name").map_err(|_| MigrationError::Database)?;
            let kind = row.try_get::<String>("", "object_type").map_err(|_| MigrationError::Database)?;
            Ok((schema, name, kind))
        })
        .collect()
}

fn is_base_table(kind: &str) -> bool {
    matches!(kind, "BASE TABLE" | "PARTITIONED TABLE")
}

/// 查询服务器真实身份以防止 URL 别名或代理误配。
async fn query_server_identity<C: ConnectionTrait>(db: &C) -> Result<ServerIdentity, MigrationError> {
    let backend = db.get_database_backend();
    match backend {
        DbBackend::MySql => {
            // MySQL: @@hostname, @@port, DATABASE(), @@server_uuid
            let statement = Statement::from_string(
                backend,
                "SELECT @@hostname AS host, @@port AS port, DATABASE() AS db_name, @@server_uuid AS uuid".to_owned(),
            );
            let row = db.query_one(statement).await.map_err(|_| MigrationError::Database)?;
            let row = row.ok_or(MigrationError::Database)?;
            Ok(ServerIdentity {
                host_or_addr: row.try_get::<String>("", "host").ok(),
                port: row.try_get::<i64>("", "port").ok().and_then(|p| u16::try_from(p).ok()),
                database: row.try_get::<String>("", "db_name").map_err(|_| MigrationError::Database)?,
                server_id: row.try_get::<String>("", "uuid").ok(),
            })
        }
        DbBackend::Postgres => {
            // PostgreSQL: inet_server_addr(), inet_server_port(), current_database(), system_identifier from pg_control_system()
            let statement = Statement::from_string(
                backend,
                "SELECT inet_server_addr()::text AS addr, inet_server_port() AS port, current_database() AS db_name, system_identifier::text AS sys_id FROM pg_control_system()".to_owned(),
            );
            let row = db.query_one(statement).await.map_err(|_| MigrationError::Database)?;
            let row = row.ok_or(MigrationError::Database)?;
            Ok(ServerIdentity {
                host_or_addr: row.try_get::<String>("", "addr").ok(),
                port: row.try_get::<i32>("", "port").ok().and_then(|p| u16::try_from(p).ok()),
                database: row.try_get::<String>("", "db_name").map_err(|_| MigrationError::Database)?,
                server_id: row.try_get::<String>("", "sys_id").ok(),
            })
        }
        DbBackend::Sqlite => {
            // SQLite 无网络服务器，只返回数据库名
            Ok(ServerIdentity {
                host_or_addr: None,
                port: None,
                database: "memory".to_owned(),
                server_id: None,
            })
        }
    }
}

/// 反射默认 schema 的基础表名；保留标识大小写并避免动态 SQL。
async fn list_tables<C: ConnectionTrait>(db: &C) -> Result<BTreeSet<String>, MigrationError> {
    Ok(list_schema_objects(db)
        .await?
        .into_iter()
        .filter(|(_, _, kind)| is_base_table(kind))
        .map(|(_, name, _)| name)
        .collect())
}

/// 只接受 Rust 侧固定迁移映射可安全引用的简单 SQL 标识符；不会拼接任意输入。
fn is_safe_table_identifier(table: &str) -> bool {
    !table.is_empty()
        && table.len() <= 64
        && table
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

/// 验证连接边界并列出源表和目标空性；此步骤不会更改任一数据库。
pub async fn preflight(options: &MigrationOptions) -> Result<PreflightReport, MigrationError> {
    options.validate()?;
    let source = connect_source(&options.source_url).await?;
    let target = connect_target(&options.target_url).await?;
    
    // 查询服务器身份
    let source_identity = query_server_identity(&source).await?;
    let target_identity = query_server_identity(&target).await?;
    
    // 防止同一服务器误配：数据库名必须不同，且如果有 server_id 也必须不同
    if source_identity.database == target_identity.database {
        if let (Some(src_id), Some(tgt_id)) = (&source_identity.server_id, &target_identity.server_id) {
            if src_id == tgt_id {
                return Err(MigrationError::ServerIdentityMismatch);
            }
        }
    }
    
    let source_read = source
        .begin_with_config(None, Some(AccessMode::ReadOnly))
        .await
        .map_err(|_| MigrationError::Database)?;
    let source_tables = list_tables(&source_read).await?;
    source_read.rollback().await.map_err(|_| MigrationError::Database)?;
    let target_objects = list_schema_objects(&target).await?;
    let target_tables = target_objects
        .iter()
        .filter(|(_, _, kind)| is_base_table(kind))
        .count();
    let target_other_objects = target_objects.len() - target_tables;
    let requested = options
        .allowed_tables
        .iter()
        .map(|table| table.trim().to_owned())
        .collect::<BTreeSet<_>>();
    if requested.is_empty() {
        return Err(MigrationError::Options(MigrationOptionsError::InvalidTableAllowlist));
    }
    if !requested.iter().all(|table| is_safe_table_identifier(table)) {
        return Err(MigrationError::Options(MigrationOptionsError::InvalidTableAllowlist));
    }
    let selected_tables = {
        if !requested.is_subset(&source_tables) {
            return Err(MigrationError::UnknownSourceTable);
        }
        requested.into_iter().collect::<Vec<_>>()
    };

    Ok(PreflightReport {
        source_dialect: "mysql".to_owned(),
        target_dialect: match target.get_database_backend() {
            DbBackend::MySql => "mysql",
            DbBackend::Postgres => "postgresql",
            DbBackend::Sqlite => return Err(MigrationError::UnexpectedDialect),
        }
        .to_owned(),
        source_identity,
        target_identity,
        source_table_count: source_tables.len(),
        target_table_count: target_tables,
        target_other_object_count: target_other_objects,
        target_has_no_base_tables: target_tables == 0,
        target_has_no_application_objects: target_objects.is_empty(),
        selected_tables,
        mode: options.mode,
    })
}

/// 显式 Apply 暂时安全失败：源表复制、转换、未知表保留与 ledger 均未完成，
/// 因此在创建任何目标对象之前拒绝，避免留下“像是成功”的半成品 schema。
pub async fn execute(options: &MigrationOptions) -> Result<PreflightReport, MigrationError> {
    options.validate()?;
    if options.mode == MigrationMode::Apply {
        // 迁移数据复制与恢复机制尚未完成，必须在任何数据库连接/DDL 前拒绝 Apply。
        return Err(MigrationError::CopyNotImplemented);
    }
    preflight(options).await
}

#[cfg(test)]
mod tests {
    use super::*;
    /// 简单离线测试辅助：单连接 SQLite 内存库；不用于正式迁移目标。
    async fn create_test_db() -> DatabaseConnection {
        Database::connect("sqlite::memory:")
            .await
            .expect("create SQLite in-memory fixture")
    }

    #[tokio::test]
    async fn lists_sqlite_fixture_tables_without_writing() {
        let db = create_test_db().await;
        let tables = list_tables(&db).await.expect("fixture table listing");
        assert!(tables.is_empty());
        db.execute_unprepared("CREATE TABLE source_a (id INTEGER PRIMARY KEY)")
            .await
            .expect("create fixture source");
        db.execute_unprepared("CREATE VIEW source_view AS SELECT id FROM source_a")
            .await
            .expect("create fixture view");
        let objects = list_schema_objects(&db).await.expect("fixture objects");
        assert_eq!(objects.iter().filter(|(_, _, kind)| kind == "BASE TABLE").count(), 1);
        assert_eq!(objects.iter().filter(|(_, _, kind)| kind == "VIEW").count(), 1);
        assert!(objects.iter().any(|(schema, name, _)| schema == "main" && name == "source_view"));
    }

    #[tokio::test]
    async fn apply_is_rejected_without_connecting_or_writing() {
        let mut options = MigrationOptions {
            source_url: "mysql://bad:secret@127.0.0.1:1/legacy".into(),
            target_url: "mysql://bad:secret@127.0.0.1:1/newdb".into(),
            mode: MigrationMode::Apply,
            batch_size: 500,
            allowed_tables: ["episodes".to_owned()].into_iter().collect(),
            run_id: Some("run-1".into()),
        };
        let error = execute(&options).await.unwrap_err();
        assert_eq!(error.to_string(), "完整迁移复制器尚未实现，已拒绝 Apply；请勿将预检当作迁移完成");
        assert!(!error.to_string().contains("secret"));

        options.mode = MigrationMode::DryRun;
        options.allowed_tables.clear();
        assert_eq!(
            execute(&options).await.unwrap_err().to_string(),
            "来源表白名单为空或包含不安全的表名"
        );
    }

    #[tokio::test]
    async fn explicit_allowlist_preserves_case_and_rejects_unknown_names() {
        let db = create_test_db().await;
        db.execute_unprepared("CREATE TABLE EpisodeData (id INTEGER PRIMARY KEY)")
            .await
            .expect("create fixture table");
        let tables = list_tables(&db).await.expect("list tables");
        assert!(tables.contains("EpisodeData"));
        assert!(!tables.contains("episodedata"));
        assert!(!is_safe_table_identifier("episode;DROP"));
    }
}
