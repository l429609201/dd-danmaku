use chrono::Utc;
use sea_orm::{ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set};

use crate::entities::{migration_run, migration_table};
use super::runner::MigrationError;

/// 迁移运行状态
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MigrationRunStatus {
    Started,
    InProgress,
    Completed,
    Failed,
    Cancelled,
}

impl MigrationRunStatus {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Started => "started",
            Self::InProgress => "in_progress",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

/// 记录迁移运行开始
pub async fn record_migration_start<C: ConnectionTrait>(
    db: &C,
    run_id: &str,
    source_identity: &str,
    target_identity: &str,
) -> Result<String, MigrationError> {
    let now = Utc::now().naive_utc();
    let run = migration_run::ActiveModel {
        run_id: Set(run_id.to_owned()),
        source_identity_hash: Set(source_identity.to_owned()),
        target_identity_hash: Set(target_identity.to_owned()),
        status: Set(MigrationRunStatus::Started.as_str().to_owned()),
        started_at: Set(now),
        finished_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    };
    
    let result = run.insert(db).await.map_err(|_| MigrationError::Database)?;
    Ok(result.run_id)
}

/// 更新迁移运行状态
pub async fn update_migration_status<C: ConnectionTrait>(
    db: &C,
    run_id: &str,
    status: MigrationRunStatus,
) -> Result<(), MigrationError> {
    let run = migration_run::Entity::find()
        .filter(migration_run::Column::RunId.eq(run_id))
        .one(db)
        .await
        .map_err(|_| MigrationError::Database)?
        .ok_or(MigrationError::Database)?;
    
    let now = Utc::now().naive_utc();
    let mut active: migration_run::ActiveModel = run.into();
    active.status = Set(status.as_str().to_owned());
    active.updated_at = Set(now);
    
    if matches!(status, MigrationRunStatus::Completed | MigrationRunStatus::Failed | MigrationRunStatus::Cancelled) {
        active.finished_at = Set(Some(now));
    }
    
    active.update(db).await.map_err(|_| MigrationError::Database)?;
    Ok(())
}

/// 记录表迁移进度
pub async fn record_table_progress<C: ConnectionTrait>(
    db: &C,
    run_id: &str,
    source_table: &str,
    target_table: &str,
    rows_read: i64,
    rows_written: i64,
    source_checksum: Option<String>,
    target_checksum: Option<String>,
) -> Result<(), MigrationError> {
    let now = Utc::now().naive_utc();
    
    // 查找已有记录
    let existing = migration_table::Entity::find()
        .filter(migration_table::Column::RunId.eq(run_id))
        .filter(migration_table::Column::SourceTable.eq(source_table))
        .one(db)
        .await
        .map_err(|_| MigrationError::Database)?;
    
    if let Some(record) = existing {
        // 更新已有记录
        let mut active: migration_table::ActiveModel = record.into();
        active.rows_read = Set(rows_read);
        active.rows_written = Set(rows_written);
        active.source_checksum = Set(source_checksum);
        active.target_checksum = Set(target_checksum);
        active.updated_at = Set(now);
        active.update(db).await.map_err(|_| MigrationError::Database)?;
    } else {
        // 插入新记录
        let record = migration_table::ActiveModel {
            run_id: Set(run_id.to_owned()),
            source_table: Set(source_table.to_owned()),
            target_table: Set(target_table.to_owned()),
            mode: Set("copy".to_owned()),
            status: Set("in_progress".to_owned()),
            rows_read: Set(rows_read),
            rows_written: Set(rows_written),
            last_source_key: Set(None),
            source_checksum: Set(source_checksum),
            target_checksum: Set(target_checksum),
            error_kind: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };
        record.insert(db).await.map_err(|_| MigrationError::Database)?;
    }
    
    Ok(())
}

/// 查询最近的迁移运行
pub async fn find_latest_migration_run<C: ConnectionTrait>(
    db: &C,
    run_id: &str,
) -> Result<Option<migration_run::Model>, MigrationError> {
    migration_run::Entity::find()
        .filter(migration_run::Column::RunId.eq(run_id))
        .one(db)
        .await
        .map_err(|_| MigrationError::Database)
}

/// 查询表迁移进度
pub async fn find_table_progress<C: ConnectionTrait>(
    db: &C,
    run_id: &str,
    source_table: &str,
) -> Result<Option<migration_table::Model>, MigrationError> {
    migration_table::Entity::find()
        .filter(migration_table::Column::RunId.eq(run_id))
        .filter(migration_table::Column::SourceTable.eq(source_table))
        .one(db)
        .await
        .map_err(|_| MigrationError::Database)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::Database;

    async fn create_test_db() -> sea_orm::DatabaseConnection {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("create test db");
        
        // 创建测试表（匹配实际 schema）
        db.execute_unprepared(
            "CREATE TABLE migration_runs (
                run_id TEXT PRIMARY KEY,
                source_identity_hash TEXT NOT NULL,
                target_identity_hash TEXT NOT NULL,
                status TEXT NOT NULL,
                started_at TEXT NOT NULL,
                finished_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"
        ).await.expect("create migration_runs");
        
        db.execute_unprepared(
            "CREATE TABLE migration_tables (
                id INTEGER PRIMARY KEY,
                run_id TEXT NOT NULL,
                source_table TEXT NOT NULL UNIQUE,
                target_table TEXT NOT NULL,
                mode TEXT NOT NULL,
                status TEXT NOT NULL,
                rows_read INTEGER NOT NULL,
                rows_written INTEGER NOT NULL,
                last_source_key TEXT,
                source_checksum TEXT,
                target_checksum TEXT,
                error_kind TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"
        ).await.expect("create migration_tables");
        
        db
    }

    #[tokio::test]
    async fn records_migration_lifecycle() {
        let db = create_test_db().await;
        
        // 记录开始
        let run_id = record_migration_start(&db, "test-run-1", "source_hash", "target_hash")
            .await
            .expect("record start");
        assert_eq!(run_id, "test-run-1");
        
        // 查询运行
        let run = find_latest_migration_run(&db, "test-run-1")
            .await
            .expect("find run")
            .expect("run exists");
        assert_eq!(run.status, "started");
        
        // 更新状态
        update_migration_status(&db, &run_id, MigrationRunStatus::InProgress)
            .await
            .expect("update status");
        
        // 记录表进度
        record_table_progress(&db, &run_id, "episodes", "episodes", 1000, 500, Some("abc123".to_owned()), None)
            .await
            .expect("record table progress");
        
        let table = find_table_progress(&db, &run_id, "episodes")
            .await
            .expect("find table")
            .expect("table exists");
        assert_eq!(table.rows_read, 1000);
        assert_eq!(table.rows_written, 500);
        
        // 完成迁移
        update_migration_status(&db, &run_id, MigrationRunStatus::Completed)
            .await
            .expect("complete migration");
    }
}
