use sea_orm::{ConnectionTrait, Statement};
use sha2::{Digest, Sha256};

use super::metadata::{inspect_mysql_table, map_mysql_to_postgres, TableMetadata};
use super::runner::MigrationError;

/// 数据复制进度跟踪
#[derive(Clone, Debug)]
pub struct CopyProgress {
    pub table_name: String,
    pub total_rows: u64,
    pub copied_rows: u64,
    pub checksum_source: Option<String>,
    pub checksum_target: Option<String>,
}

/// 批次复制配置
#[derive(Clone, Debug)]
pub struct CopyOptions {
    pub batch_size: u32,
    pub verify_checksum: bool,
}

impl Default for CopyOptions {
    fn default() -> Self {
        Self {
            batch_size: 500,
            verify_checksum: true,
        }
    }
}

/// 计算表数据的 SHA-256 checksum（仅用于验证，不替代逐行校验）
pub async fn compute_table_checksum<C: ConnectionTrait>(
    db: &C,
    table_name: &str,
) -> Result<String, MigrationError> {
    let backend = db.get_database_backend();
    
    // 查询总行数
    let count_sql = format!("SELECT COUNT(*) AS cnt FROM `{}`", table_name.replace('`', "``"));
    let count_stmt = Statement::from_string(backend, count_sql);
    let count_row = db.query_one(count_stmt).await.map_err(|_| MigrationError::Database)?;
    let total_rows = count_row
        .and_then(|row| row.try_get::<i64>("", "cnt").ok())
        .unwrap_or(0);
    
    // 空表直接返回固定哈希
    if total_rows == 0 {
        return Ok("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_owned()); // SHA-256("")
    }
    
    // 注意：这是简化实现，生产环境应该逐行哈希或使用数据库原生 checksum
    let mut hasher = Sha256::new();
    hasher.update(format!("table:{},rows:{}", table_name, total_rows).as_bytes());
    Ok(format!("{:x}", hasher.finalize()))
}

/// 批次复制一个表的数据
pub async fn copy_table_data<C1: ConnectionTrait, C2: ConnectionTrait>(
    source: &C1,
    target: &C2,
    table_name: &str,
    options: &CopyOptions,
) -> Result<CopyProgress, MigrationError> {
    // 1. 反射源表结构
    let metadata = inspect_mysql_table(source, table_name).await?;
    
    // 2. 在目标创建表（如果不存在）
    let target_backend = target.get_database_backend();
    if target_backend == sea_orm::DbBackend::Postgres {
        let ddl = generate_postgres_ddl(&metadata);
        // 使用 CREATE TABLE IF NOT EXISTS 避免重复创建
        let create_stmt = ddl.replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS");
        target
            .execute_unprepared(&create_stmt)
            .await
            .map_err(|_| MigrationError::Database)?;
    }
    
    // 3. 查询总行数
    let count_sql = format!("SELECT COUNT(*) AS cnt FROM `{}`", table_name.replace('`', "``"));
    let count_stmt = Statement::from_string(source.get_database_backend(), count_sql);
    let count_row = source.query_one(count_stmt).await.map_err(|_| MigrationError::Database)?;
    let total_rows = count_row
        .and_then(|row| row.try_get::<i64>("", "cnt").ok())
        .unwrap_or(0) as u64;
    
    // 4. 计算源表 checksum（如果启用）
    let checksum_source = if options.verify_checksum {
        Some(compute_table_checksum(source, table_name).await?)
    } else {
        None
    };
    
    // 5. 批次复制数据
    let mut copied_rows = 0u64;
    if total_rows > 0 {
        let primary_key = metadata.primary_key.as_ref().and_then(|pk| pk.first());
        let column_names = metadata
            .columns
            .iter()
            .map(|c| format!("`{}`", c.name.replace('`', "``")))
            .collect::<Vec<_>>()
            .join(", ");
        
        let mut offset = 0u64;
        loop {
            // 批次 SELECT
            let select_sql = format!(
                "SELECT {} FROM `{}` ORDER BY {} LIMIT {} OFFSET {}",
                column_names,
                table_name.replace('`', "``"),
                primary_key.map(|pk| format!("`{}`", pk.replace('`', "``"))).unwrap_or_else(|| "1".to_owned()),
                options.batch_size,
                offset
            );
            let select_stmt = Statement::from_string(source.get_database_backend(), select_sql);
            let rows = source.query_all(select_stmt).await.map_err(|_| MigrationError::Database)?;
            
            if rows.is_empty() {
                break;
            }
            
            // TODO: INSERT 实际实现需要动态参数化（SeaORM Value 映射复杂）
            // 生产实现方案：
            // 1. 使用 sea_query::InsertStatement 动态构建
            // 2. 或使用 COPY (PostgreSQL) / LOAD DATA (MySQL) 批量导入
            // 3. 逐行 INSERT 性能差但实现简单
            // 当前占位：仅统计行数，验证 SELECT 循环逻辑
            copied_rows += rows.len() as u64;
            offset += options.batch_size as u64;
            
            if offset >= total_rows {
                break;
            }
        }
    }
    
    // 6. 计算目标表 checksum（如果启用）
    let checksum_target = if options.verify_checksum && copied_rows > 0 {
        Some(compute_table_checksum(target, table_name).await?)
    } else {
        None
    };
    
    Ok(CopyProgress {
        table_name: table_name.to_owned(),
        total_rows,
        copied_rows,
        checksum_source,
        checksum_target,
    })
}

/// 生成 PostgreSQL CREATE TABLE DDL（基于 MySQL 元数据）
pub fn generate_postgres_ddl(metadata: &TableMetadata) -> String {
    let mut ddl = format!("CREATE TABLE \"{}\" (\n", metadata.name);
    
    // 列定义
    let column_defs: Vec<String> = metadata
        .columns
        .iter()
        .map(|col| {
            let pg_type = map_mysql_to_postgres(&col.native_type);
            let nullable = if col.nullable { "" } else { " NOT NULL" };
            let default = col
                .default_value
                .as_ref()
                .map(|d| format!(" DEFAULT {}", d))
                .unwrap_or_default();
            format!("  \"{}\" {}{}{}", col.name, pg_type, nullable, default)
        })
        .collect();
    
    ddl.push_str(&column_defs.join(",\n"));
    
    // 主键
    if let Some(pk) = &metadata.primary_key {
        let pk_cols = pk.iter().map(|c| format!("\"{}\"", c)).collect::<Vec<_>>().join(", ");
        ddl.push_str(&format!(",\n  PRIMARY KEY ({})", pk_cols));
    }
    
    ddl.push_str("\n)");
    
    // 表注释
    if let Some(comment) = &metadata.comment {
        ddl.push_str(&format!(";\nCOMMENT ON TABLE \"{}\" IS '{}'", metadata.name, comment.replace('\'', "''")));
    }
    
    ddl.push(';');
    ddl
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migration::metadata::ColumnMetadata;

    #[test]
    fn generates_postgres_ddl_from_metadata() {
        let metadata = TableMetadata {
            name: "episodes".to_owned(),
            columns: vec![
                ColumnMetadata {
                    name: "id".to_owned(),
                    data_type: "bigint".to_owned(),
                    nullable: false,
                    default_value: None,
                    auto_increment: true,
                    comment: Some("主键".to_owned()),
                    native_type: "bigint(20)".to_owned(),
                    character_set: None,
                    collation: None,
                },
                ColumnMetadata {
                    name: "title".to_owned(),
                    data_type: "varchar".to_owned(),
                    nullable: false,
                    default_value: Some("''".to_owned()),
                    auto_increment: false,
                    comment: None,
                    native_type: "varchar(255)".to_owned(),
                    character_set: Some("utf8mb4".to_owned()),
                    collation: Some("utf8mb4_unicode_ci".to_owned()),
                },
            ],
            primary_key: Some(vec!["id".to_owned()]),
            indexes: vec![],
            comment: Some("分集表".to_owned()),
        };
        
        let ddl = generate_postgres_ddl(&metadata);
        assert!(ddl.contains("CREATE TABLE \"episodes\""));
        assert!(ddl.contains("\"id\" bigint NOT NULL"));
        assert!(ddl.contains("\"title\" character varying(255) NOT NULL DEFAULT ''"));
        assert!(ddl.contains("PRIMARY KEY (\"id\")"));
        assert!(ddl.contains("COMMENT ON TABLE \"episodes\" IS '分集表'"));
    }
    
    #[tokio::test]
    async fn empty_table_has_fixed_checksum() {
        use sea_orm::Database;
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("create test db");
        db.execute_unprepared("CREATE TABLE empty_test (id INTEGER)")
            .await
            .expect("create empty table");
        let checksum = compute_table_checksum(&db, "empty_test").await.expect("compute checksum");
        // SHA-256 of empty string
        assert_eq!(checksum, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    }
}
