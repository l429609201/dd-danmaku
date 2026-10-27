use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use url::Url;

pub mod runner;
pub mod metadata;
pub mod copier;
pub mod ledger;
pub mod recovery;

pub use runner::{execute, preflight, MigrationError, PreflightReport, ServerIdentity};
pub use metadata::{inspect_mysql_table, map_mysql_to_postgres, TableMetadata, ColumnMetadata, IndexMetadata};
pub use copier::{copy_table_data, compute_table_checksum, generate_postgres_ddl, CopyOptions, CopyProgress};
pub use ledger::{
    record_migration_start, update_migration_status, record_table_progress,
    find_latest_migration_run, find_table_progress, MigrationRunStatus,
};
pub use recovery::{
    find_recoverable_checkpoint, should_skip_table, get_resume_point,
    verify_idempotent_reentry, CheckpointInfo, TableCheckpoint,
};

/// 迁移执行模式；默认 DryRun，只有显式 Apply 才允许写目标。
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub enum MigrationMode {
    #[default]
    DryRun,
    Apply,
}

/// 迁移边界配置。连接串仅在进程内使用，禁止写入日志或账本。
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MigrationOptions {
    pub source_url: String,
    pub target_url: String,
    pub mode: MigrationMode,
    pub batch_size: u32,
    pub allowed_tables: BTreeSet<String>,
    pub run_id: Option<String>,
}

impl Default for MigrationOptions {
    fn default() -> Self {
        Self {
            source_url: String::new(),
            target_url: String::new(),
            mode: MigrationMode::DryRun,
            batch_size: 500,
            allowed_tables: BTreeSet::new(),
            run_id: None,
        }
    }
}

#[derive(Debug, thiserror::Error, Eq, PartialEq)]
pub enum MigrationOptionsError {
    #[error("来源和目标数据库连接地址不能为空")]
    EmptyUrl,
    #[error("数据库连接地址格式无效")]
    InvalidUrl,
    #[error("来源表白名单为空或包含不安全的表名")]
    InvalidTableAllowlist,
    #[error("来源数据库必须是 MySQL，目标数据库必须是 MySQL 或 PostgreSQL")]
    UnsupportedDialect,
    #[error("来源和目标数据库身份相同，已拒绝迁移")]
    SameDatabase,
    #[error("无法从数据库连接确认预期方言")]
    UnexpectedDialect,
    #[error("batch_size 必须大于 0")]
    InvalidBatchSize,
    #[error("run_id 包含不安全字符")]
    InvalidRunId,
}

impl MigrationOptions {
    pub fn validate(&self) -> Result<(), MigrationOptionsError> {
        if self.source_url.trim().is_empty() || self.target_url.trim().is_empty() {
            return Err(MigrationOptionsError::EmptyUrl);
        }
        if self.batch_size == 0 {
            return Err(MigrationOptionsError::InvalidBatchSize);
        }
        if self.allowed_tables.is_empty()
            || self.allowed_tables.iter().any(|table| {
                table.is_empty()
                    || table.len() > 64
                    || !table
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
            })
        {
            return Err(MigrationOptionsError::InvalidTableAllowlist);
        }
        let source = parse_url(&self.source_url)?;
        let target = parse_url(&self.target_url)?;
        if source.scheme() != "mysql"
            || !matches!(target.scheme(), "mysql" | "postgres" | "postgresql")
        {
            return Err(MigrationOptionsError::UnsupportedDialect);
        }
        if database_identity(&source) == database_identity(&target) {
            return Err(MigrationOptionsError::SameDatabase);
        }
        if let Some(run_id) = &self.run_id {
            if run_id.is_empty()
                || !run_id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
            {
                return Err(MigrationOptionsError::InvalidRunId);
            }
        }
        Ok(())
    }
}

fn parse_url(value: &str) -> Result<Url, MigrationOptionsError> {
    Url::parse(value).map_err(|_| MigrationOptionsError::InvalidUrl)
}

/// 数据库身份不包含用户名、密码、query 或 fragment。
pub(crate) fn database_identity(url: &Url) -> String {
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let port = url.port_or_known_default().unwrap_or_default();
    let database = url.path().trim_matches('/').to_owned();
    format!("{}|{}|{}|{}", url.scheme().to_ascii_lowercase(), host, port, database)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options(source_url: &str, target_url: &str) -> MigrationOptions {
        MigrationOptions {
            source_url: source_url.into(),
            target_url: target_url.into(),
            mode: MigrationMode::DryRun,
            batch_size: 500,
            allowed_tables: ["episodes".to_owned()].into_iter().collect(),
            run_id: Some("run-1".into()),
        }
    }

    #[test]
    fn rejects_same_database_without_logging_credentials() {
        let error = options(
            "mysql://readonly:source-secret@db.example/legacy",
            "mysql://owner:target-secret@db.example/legacy",
        )
        .validate()
        .unwrap_err();
        assert_eq!(error, MigrationOptionsError::SameDatabase);
        assert!(!error.to_string().contains("secret"));
    }

    #[test]
    fn validates_supported_dialects_and_safe_run_id() {
        assert!(options("mysql://a@old/legacy", "postgresql://b@new/app")
            .validate()
            .is_ok());
        assert_eq!(
            options("postgresql://a@old/legacy", "postgresql://b@new/app").validate(),
            Err(MigrationOptionsError::UnsupportedDialect)
        );
        let mut invalid = options("mysql://a@old/legacy", "mysql://b@new/app");
        invalid.run_id = Some("run;drop".into());
        assert_eq!(invalid.validate(), Err(MigrationOptionsError::InvalidRunId));
    }

    #[test]
    fn rejects_malformed_urls_and_zero_batch_size() {
        assert_eq!(
            options("not a URL", "postgresql://b@new/app").validate(),
            Err(MigrationOptionsError::InvalidUrl)
        );
        let mut invalid = options("mysql://a@old/legacy", "mysql://b@new/app");
        invalid.batch_size = 0;
        assert_eq!(invalid.validate(), Err(MigrationOptionsError::InvalidBatchSize));
    }

    #[test]
    fn defaults_to_dry_run_but_requires_explicit_source_allowlist() {
        let defaults = MigrationOptions::default();
        assert_eq!(defaults.mode, MigrationMode::DryRun);
        assert_eq!(defaults.batch_size, 500);
        assert_eq!(defaults.validate(), Err(MigrationOptionsError::EmptyUrl));

        let mut invalid = options("mysql://a@old/legacy", "postgresql://b@new/app");
        invalid.allowed_tables.clear();
        assert_eq!(invalid.validate(), Err(MigrationOptionsError::InvalidTableAllowlist));

        invalid.allowed_tables.insert("episodes;drop".into());
        assert_eq!(invalid.validate(), Err(MigrationOptionsError::InvalidTableAllowlist));
    }
}
