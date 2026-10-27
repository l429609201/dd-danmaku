use super::ledger::{find_latest_migration_run, find_table_progress, MigrationRunStatus};
use super::metadata::inspect_mysql_table;
use super::runner::MigrationError;
use crate::entities::migration_table;
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter};

/// Checkpoint 恢复信息
#[derive(Clone, Debug)]
pub struct CheckpointInfo {
    pub run_id: String,
    pub status: String,
    pub tables_completed: Vec<String>,
    pub tables_in_progress: Vec<TableCheckpoint>,
}

/// 表级 checkpoint
#[derive(Clone, Debug)]
pub struct TableCheckpoint {
    pub table_name: String,
    pub rows_read: i64,
    pub rows_written: i64,
    pub last_key: Option<String>,
}

/// 查询可恢复的 checkpoint
pub async fn find_recoverable_checkpoint<C: ConnectionTrait>(
    db: &C,
    run_id: &str,
) -> Result<Option<CheckpointInfo>, MigrationError> {
    // 查询运行记录
    let run = find_latest_migration_run(db, run_id).await?;
    let run = match run {
        Some(r) if r.status != MigrationRunStatus::Completed.as_str() => r,
        _ => return Ok(None),
    };
    
    // 查询所有表进度
    let tables = migration_table::Entity::find()
        .filter(migration_table::Column::RunId.eq(run_id))
        .all(db)
        .await
        .map_err(|_| MigrationError::Database)?;
    
    let mut completed = Vec::new();
    let mut in_progress = Vec::new();
    
    for table in tables {
        if table.status == "completed" {
            completed.push(table.source_table);
        } else {
            in_progress.push(TableCheckpoint {
                table_name: table.source_table,
                rows_read: table.rows_read,
                rows_written: table.rows_written,
                last_key: table.last_source_key,
            });
        }
    }
    
    Ok(Some(CheckpointInfo {
        run_id: run.run_id,
        status: run.status,
        tables_completed: completed,
        tables_in_progress: in_progress,
    }))
}

/// 验证表是否需要跳过（已完成）
pub async fn should_skip_table<C: ConnectionTrait>(
    db: &C,
    run_id: &str,
    table_name: &str,
) -> Result<bool, MigrationError> {
    let progress = find_table_progress(db, run_id, table_name).await?;
    Ok(progress.map(|p| p.status == "completed").unwrap_or(false))
}

/// 获取表的续传起点（主键值）
pub async fn get_resume_point<C: ConnectionTrait>(
    db: &C,
    run_id: &str,
    table_name: &str,
) -> Result<Option<String>, MigrationError> {
    let progress = find_table_progress(db, run_id, table_name).await?;
    Ok(progress.and_then(|p| p.last_source_key))
}

/// 幂等性验证：检查运行是否可以安全重入
pub async fn verify_idempotent_reentry<C: ConnectionTrait>(
    source: &C,
    target: &C,
    run_id: &str,
    table_name: &str,
) -> Result<bool, MigrationError> {
    // 1. 检查源表结构是否改变
    let source_metadata = inspect_mysql_table(source, table_name).await?;
    
    // 2. 查询已记录的进度
    let progress = find_table_progress(target, run_id, table_name).await?;
    
    match progress {
        None => {
            // 首次运行，幂等
            Ok(true)
        }
        Some(p) => {
            // 检查源表主键是否存在
            if source_metadata.primary_key.is_none() && p.last_source_key.is_some() {
                // 无主键但有 last_key，无法续传
                return Ok(false);
            }
            
            // 检查 checksum 是否匹配（如果已完成）
            if p.status == "completed" {
                if let Some(recorded_checksum) = p.source_checksum {
                    let current_checksum = super::copier::compute_table_checksum(source, table_name).await?;
                    if recorded_checksum != current_checksum {
                        // 源表数据已变化，不幂等
                        return Ok(false);
                    }
                }
            }
            
            // 可以安全重入
            Ok(true)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migration::ledger::{record_migration_start, record_table_progress, update_migration_status};
    use sea_orm::Database;

    async fn create_test_db() -> sea_orm::DatabaseConnection {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("create test db");
        
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
    async fn finds_recoverable_checkpoint() {
        let db = create_test_db().await;
        
        // 创建一个进行中的迁移
        let run_id = record_migration_start(&db, "test-run", "src", "tgt")
            .await
            .expect("start migration");
        
        update_migration_status(&db, &run_id, MigrationRunStatus::InProgress)
            .await
            .expect("update status");
        
        // 记录两个表的进度
        record_table_progress(&db, &run_id, "table1", "table1", 1000, 1000, None, None)
            .await
            .expect("record table1");
        
        record_table_progress(&db, &run_id, "table2", "table2", 500, 300, None, None)
            .await
            .expect("record table2");
        
        // 查询 checkpoint
        let checkpoint = find_recoverable_checkpoint(&db, &run_id)
            .await
            .expect("find checkpoint")
            .expect("checkpoint exists");
        
        assert_eq!(checkpoint.run_id, run_id);
        assert_eq!(checkpoint.tables_in_progress.len(), 2);
    }

    #[tokio::test]
    async fn verifies_table_skip() {
        let db = create_test_db().await;
        
        let run_id = record_migration_start(&db, "test-run", "src", "tgt")
            .await
            .expect("start");
        
        // 未记录的表不跳过
        let should_skip = should_skip_table(&db, &run_id, "new_table")
            .await
            .expect("check skip");
        assert!(!should_skip);
        
        // 记录进度
        record_table_progress(&db, &run_id, "table1", "table1", 1000, 1000, None, None)
            .await
            .expect("record");
        
        // 进行中的表不跳过
        let should_skip = should_skip_table(&db, &run_id, "table1")
            .await
            .expect("check skip");
        assert!(!should_skip);
    }
}
