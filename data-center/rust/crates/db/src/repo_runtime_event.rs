use sea_orm::*;
use crate::entities::runtime_event;

/// runtime_events 表的数据访问层
pub struct RuntimeEventRepo;

/// 事件查询参数
#[derive(Debug, Clone)]
pub struct EventQuery {
    pub page: u64,
    pub page_size: u64,
    pub level: Option<String>,
    pub category: Option<String>,
    pub event: Option<String>,
}

impl Default for EventQuery {
    fn default() -> Self {
        Self {
            page: 1,
            page_size: 50,
            level: None,
            category: None,
            event: None,
        }
    }
}

impl RuntimeEventRepo {
    /// 记录事件
    pub async fn log(
        db: &DatabaseConnection,
        level: String,
        category: String,
        event: String,
        message: String,
        details: Option<serde_json::Value>,
    ) -> Result<runtime_event::Model, DbErr> {
        use chrono::Utc;
        
        let new_event = runtime_event::ActiveModel {
            level: Set(level),
            category: Set(category),
            event: Set(event),
            message: Set(message),
            details_json: Set(details),
            created_at: Set(Utc::now().naive_utc()),
            ..Default::default()
        };
        
        new_event.insert(db).await
    }

    /// 分页查询事件
    pub async fn find_paginated(
        db: &DatabaseConnection,
        query: &EventQuery,
    ) -> Result<(Vec<runtime_event::Model>, u64), DbErr> {
        let mut select = runtime_event::Entity::find();
        
        // 应用过滤条件
        if let Some(ref level) = query.level {
            select = select.filter(runtime_event::Column::Level.eq(level));
        }
        if let Some(ref category) = query.category {
            select = select.filter(runtime_event::Column::Category.eq(category));
        }
        if let Some(ref event) = query.event {
            select = select.filter(runtime_event::Column::Event.eq(event));
        }
        
        // 总数
        let total = select.clone().count(db).await?;
        
        // 分页 + 排序（最新的在前）
        let offset = (query.page - 1) * query.page_size;
        let items = select
            .order_by_desc(runtime_event::Column::CreatedAt)
            .order_by_desc(runtime_event::Column::Id)
            .limit(query.page_size)
            .offset(offset)
            .all(db)
            .await?;
        
        Ok((items, total))
    }

    /// 删除旧事件（保留期清理）
    /// 注意：SeaORM 的 delete_many 不支持 limit，需要先查询 ID 再批量删除
    pub async fn delete_before(
        db: &DatabaseConnection,
        before: chrono::NaiveDateTime,
        batch_size: u64,
    ) -> Result<u64, DbErr> {
        // 先查询要删除的 ID
        let ids: Vec<i32> = runtime_event::Entity::find()
            .filter(runtime_event::Column::CreatedAt.lt(before))
            .select_only()
            .column(runtime_event::Column::Id)
            .limit(batch_size)
            .into_tuple()
            .all(db)
            .await?;
        
        if ids.is_empty() {
            return Ok(0);
        }
        
        // 批量删除
        let result = runtime_event::Entity::delete_many()
            .filter(runtime_event::Column::Id.is_in(ids))
            .exec(db)
            .await?;
        
        Ok(result.rows_affected)
    }

    /// 统计各级别的事件数量
    pub async fn count_by_level(
        db: &DatabaseConnection,
    ) -> Result<Vec<(String, i64)>, DbErr> {
        use sea_orm::sea_query::Expr;
        
        let results = runtime_event::Entity::find()
            .select_only()
            .column(runtime_event::Column::Level)
            .column_as(Expr::col(runtime_event::Column::Id).count(), "count")
            .group_by(runtime_event::Column::Level)
            .into_tuple::<(String, i64)>()
            .all(db)
            .await?;
        
        Ok(results)
    }

    /// 获取最近的错误事件
    pub async fn recent_errors(
        db: &DatabaseConnection,
        limit: u64,
    ) -> Result<Vec<runtime_event::Model>, DbErr> {
        runtime_event::Entity::find()
            .filter(runtime_event::Column::Level.eq("ERROR"))
            .order_by_desc(runtime_event::Column::CreatedAt)
            .limit(limit)
            .all(db)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DbConfig, init_db, test_helper::create_test_schema};

    #[tokio::test]
    async fn test_log_and_query() {
        let config = DbConfig::default();
        let db = init_db(&config).await.unwrap();
        create_test_schema(&db).await.unwrap();
        
        // 记录事件
        RuntimeEventRepo::log(
            &db,
            "INFO".to_string(),
            "control".to_string(),
            "node_connected".to_string(),
            "Node test-1 connected".to_string(),
            None,
        )
        .await
        .unwrap();
        
        RuntimeEventRepo::log(
            &db,
            "ERROR".to_string(),
            "cache".to_string(),
            "query_failed".to_string(),
            "Cache query failed".to_string(),
            Some(serde_json::json!({"error": "timeout"})),
        )
        .await
        .unwrap();
        
        // 分页查询
        let query = EventQuery {
            page: 1,
            page_size: 10,
            level: None,
            category: None,
            event: None,
        };
        
        let (items, total) = RuntimeEventRepo::find_paginated(&db, &query)
            .await
            .unwrap();
        
        assert_eq!(total, 2);
        assert_eq!(items.len(), 2);
    }

    #[tokio::test]
    async fn test_recent_errors() {
        let config = DbConfig::default();
        let db = init_db(&config).await.unwrap();
        create_test_schema(&db).await.unwrap();
        
        // 记录多个事件
        RuntimeEventRepo::log(
            &db,
            "INFO".to_string(),
            "system".to_string(),
            "startup".to_string(),
            "System started".to_string(),
            None,
        )
        .await
        .unwrap();
        
        RuntimeEventRepo::log(
            &db,
            "ERROR".to_string(),
            "worker".to_string(),
            "connection_failed".to_string(),
            "Worker connection failed".to_string(),
            None,
        )
        .await
        .unwrap();
        
        // 获取错误
        let errors = RuntimeEventRepo::recent_errors(&db, 10).await.unwrap();
        
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].level, "ERROR");
    }

    #[tokio::test]
    async fn test_count_by_level() {
        let config = DbConfig::default();
        let db = init_db(&config).await.unwrap();
        create_test_schema(&db).await.unwrap();
        
        // 记录不同级别的事件
        RuntimeEventRepo::log(&db, "INFO".to_string(), "test".to_string(), "e1".to_string(), "m1".to_string(), None).await.unwrap();
        RuntimeEventRepo::log(&db, "INFO".to_string(), "test".to_string(), "e2".to_string(), "m2".to_string(), None).await.unwrap();
        RuntimeEventRepo::log(&db, "WARN".to_string(), "test".to_string(), "e3".to_string(), "m3".to_string(), None).await.unwrap();
        RuntimeEventRepo::log(&db, "ERROR".to_string(), "test".to_string(), "e4".to_string(), "m4".to_string(), None).await.unwrap();
        
        // 统计
        let counts = RuntimeEventRepo::count_by_level(&db).await.unwrap();
        
        assert!(counts.iter().any(|(l, c)| l == "INFO" && *c == 2));
        assert!(counts.iter().any(|(l, c)| l == "WARN" && *c == 1));
        assert!(counts.iter().any(|(l, c)| l == "ERROR" && *c == 1));
    }
}
