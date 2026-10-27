use sea_orm::{ConnectionTrait, DbBackend, Statement};

use super::runner::MigrationError;

/// 表的完整元数据定义，用于跨方言迁移
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TableMetadata {
    pub name: String,
    pub columns: Vec<ColumnMetadata>,
    pub primary_key: Option<Vec<String>>,
    pub indexes: Vec<IndexMetadata>,
    pub comment: Option<String>,
}

/// 列的元数据定义
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ColumnMetadata {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub auto_increment: bool,
    pub comment: Option<String>,
    /// MySQL 原始类型用于映射
    pub native_type: String,
    pub character_set: Option<String>,
    pub collation: Option<String>,
}

/// 索引元数据定义
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IndexMetadata {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
    pub index_type: Option<String>,
}

/// 从 MySQL 反射表的完整元数据
pub async fn inspect_mysql_table<C: ConnectionTrait>(
    db: &C,
    table_name: &str,
) -> Result<TableMetadata, MigrationError> {
    let backend = db.get_database_backend();
    if backend != DbBackend::MySql {
        return Err(MigrationError::UnexpectedDialect);
    }

    // 查询列信息
    let columns_sql = format!(
        "SELECT COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, \
         EXTRA, COLUMN_COMMENT, CHARACTER_SET_NAME, COLLATION_NAME \
         FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '{}' \
         ORDER BY ORDINAL_POSITION",
        table_name.replace('\'', "''")
    );
    let columns_stmt = Statement::from_string(backend, columns_sql);
    let columns_rows = db.query_all(columns_stmt).await.map_err(|_| MigrationError::Database)?;

    let columns = columns_rows
        .into_iter()
        .map(|row| {
            let name = row
                .try_get::<String>("", "COLUMN_NAME")
                .map_err(|_| MigrationError::Database)?;
            let column_type = row
                .try_get::<String>("", "COLUMN_TYPE")
                .map_err(|_| MigrationError::Database)?;
            let data_type = row
                .try_get::<String>("", "DATA_TYPE")
                .map_err(|_| MigrationError::Database)?;
            let nullable = row
                .try_get::<String>("", "IS_NULLABLE")
                .map_err(|_| MigrationError::Database)?
                == "YES";
            let default_value = row.try_get::<String>("", "COLUMN_DEFAULT").ok();
            let extra = row.try_get::<String>("", "EXTRA").unwrap_or_default();
            let auto_increment = extra.contains("auto_increment");
            let comment = row.try_get::<String>("", "COLUMN_COMMENT").ok();
            let character_set = row.try_get::<String>("", "CHARACTER_SET_NAME").ok();
            let collation = row.try_get::<String>("", "COLLATION_NAME").ok();

            Ok(ColumnMetadata {
                name,
                data_type,
                nullable,
                default_value,
                auto_increment,
                comment,
                native_type: column_type,
                character_set,
                collation,
            })
        })
        .collect::<Result<Vec<_>, MigrationError>>()?;

    // 查询主键
    let pk_sql = format!(
        "SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE \
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '{}' \
         AND CONSTRAINT_NAME = 'PRIMARY' \
         ORDER BY ORDINAL_POSITION",
        table_name.replace('\'', "''")
    );
    let pk_stmt = Statement::from_string(backend, pk_sql);
    let pk_rows = db.query_all(pk_stmt).await.map_err(|_| MigrationError::Database)?;
    let primary_key = if pk_rows.is_empty() {
        None
    } else {
        Some(
            pk_rows
                .into_iter()
                .map(|row| row.try_get::<String>("", "COLUMN_NAME").map_err(|_| MigrationError::Database))
                .collect::<Result<Vec<_>, _>>()?,
        )
    };

    // 查询索引（排除主键）
    let idx_sql = format!(
        "SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, INDEX_TYPE \
         FROM information_schema.STATISTICS \
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '{}' \
         AND INDEX_NAME != 'PRIMARY' \
         ORDER BY INDEX_NAME, SEQ_IN_INDEX",
        table_name.replace('\'', "''")
    );
    let idx_stmt = Statement::from_string(backend, idx_sql);
    let idx_rows = db.query_all(idx_stmt).await.map_err(|_| MigrationError::Database)?;

    let mut indexes: Vec<IndexMetadata> = Vec::new();
    for row in idx_rows {
        let index_name = row
            .try_get::<String>("", "INDEX_NAME")
            .map_err(|_| MigrationError::Database)?;
        let column_name = row
            .try_get::<String>("", "COLUMN_NAME")
            .map_err(|_| MigrationError::Database)?;
        let non_unique = row.try_get::<i64>("", "NON_UNIQUE").map_err(|_| MigrationError::Database)?;
        let index_type = row.try_get::<String>("", "INDEX_TYPE").ok();

        if let Some(existing) = indexes.iter_mut().find(|idx| idx.name == index_name) {
            existing.columns.push(column_name);
        } else {
            indexes.push(IndexMetadata {
                name: index_name,
                columns: vec![column_name],
                unique: non_unique == 0,
                index_type,
            });
        }
    }

    // 查询表注释
    let comment_sql = format!(
        "SELECT TABLE_COMMENT FROM information_schema.TABLES \
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '{}'",
        table_name.replace('\'', "''")
    );
    let comment_stmt = Statement::from_string(backend, comment_sql);
    let comment_row = db.query_one(comment_stmt).await.map_err(|_| MigrationError::Database)?;
    let comment = comment_row.and_then(|row| row.try_get::<String>("", "TABLE_COMMENT").ok());

    Ok(TableMetadata {
        name: table_name.to_owned(),
        columns,
        primary_key,
        indexes,
        comment,
    })
}

/// MySQL 到 PostgreSQL 的类型映射
pub fn map_mysql_to_postgres(mysql_type: &str) -> String {
    let lower = mysql_type.to_lowercase();
    
    // 整数类型
    if lower.starts_with("tinyint(1)") {
        return "boolean".to_owned();
    }
    if lower.starts_with("tinyint") {
        return "smallint".to_owned();
    }
    if lower.starts_with("smallint") {
        return "smallint".to_owned();
    }
    if lower.starts_with("mediumint") {
        return "integer".to_owned();
    }
    if lower.starts_with("int") || lower.starts_with("integer") {
        return "integer".to_owned();
    }
    if lower.starts_with("bigint") {
        return "bigint".to_owned();
    }
    
    // 浮点类型
    if lower.starts_with("float") {
        return "real".to_owned();
    }
    if lower.starts_with("double") {
        return "double precision".to_owned();
    }
    if lower.starts_with("decimal") || lower.starts_with("numeric") {
        // 保留精度：decimal(10,2) -> numeric(10,2)
        return mysql_type.replace("decimal", "numeric");
    }
    
    // 字符串类型
    if lower.starts_with("char(") {
        return mysql_type.replace("char", "character");
    }
    if lower.starts_with("varchar") {
        return mysql_type.replace("varchar", "character varying");
    }
    if lower.starts_with("tinytext") || lower.starts_with("text") {
        return "text".to_owned();
    }
    if lower.starts_with("mediumtext") || lower.starts_with("longtext") {
        return "text".to_owned();
    }
    
    // 二进制类型
    if lower.starts_with("tinyblob") || lower.starts_with("blob") {
        return "bytea".to_owned();
    }
    if lower.starts_with("mediumblob") || lower.starts_with("longblob") {
        return "bytea".to_owned();
    }
    if lower.starts_with("binary") || lower.starts_with("varbinary") {
        return "bytea".to_owned();
    }
    
    // 时间类型
    if lower.starts_with("datetime") {
        return "timestamp".to_owned();
    }
    if lower.starts_with("timestamp") {
        return "timestamp".to_owned();
    }
    if lower.starts_with("date") {
        return "date".to_owned();
    }
    if lower.starts_with("time") {
        return "time".to_owned();
    }
    if lower.starts_with("year") {
        return "smallint".to_owned();
    }
    
    // JSON
    if lower == "json" {
        return "jsonb".to_owned();
    }
    
    // ENUM/SET 转 text
    if lower.starts_with("enum") || lower.starts_with("set") {
        return "text".to_owned();
    }
    
    // 默认保持原样并标记警告
    format!("text /* UNMAPPED: {} */", mysql_type)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_mysql_types_to_postgres() {
        assert_eq!(map_mysql_to_postgres("tinyint(1)"), "boolean");
        assert_eq!(map_mysql_to_postgres("int(11)"), "integer");
        assert_eq!(map_mysql_to_postgres("bigint(20)"), "bigint");
        assert_eq!(map_mysql_to_postgres("varchar(255)"), "character varying(255)");
        assert_eq!(map_mysql_to_postgres("text"), "text");
        assert_eq!(map_mysql_to_postgres("datetime"), "timestamp");
        assert_eq!(map_mysql_to_postgres("json"), "jsonb");
        assert_eq!(map_mysql_to_postgres("enum('a','b')"), "text");
        assert!(map_mysql_to_postgres("unknown_type").contains("UNMAPPED"));
    }
}
