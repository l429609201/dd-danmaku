use sea_orm::*;
use crate::entities::control_message;

/// control_messages 表的数据访问层
pub struct ControlMessageRepo;

/// 分页查询参数
#[derive(Debug, Clone)]
pub struct MessageQuery {
    pub page: u64,
    pub page_size: u64,
    pub node_id: Option<String>,
    pub direction: Option<String>,
    pub message_type: Option<String>,
    pub status: Option<String>,
}

impl Default for MessageQuery {
    fn default() -> Self {
        Self {
            page: 1,
            page_size: 50,
            node_id: None,
            direction: None,
            message_type: None,
            status: None,
        }
    }
}

impl ControlMessageRepo {
    /// 批量插入消息（用于审计日志批量落库）
    pub async fn batch_insert(
        db: &DatabaseConnection,
        messages: Vec<control_message::ActiveModel>,
    ) -> Result<(), DbErr> {
        if messages.is_empty() {
            return Ok(());
        }
        
        control_message::Entity::insert_many(messages)
            .exec(db)
            .await?;
        
        Ok(())
    }

    /// 分页查询消息
    pub async fn find_paginated(
        db: &DatabaseConnection,
        query: &MessageQuery,
    ) -> Result<(Vec<control_message::Model>, u64), DbErr> {
        let mut select = control_message::Entity::find();
        
        // 应用过滤条件
        if let Some(ref node_id) = query.node_id {
            select = select.filter(control_message::Column::NodeId.eq(node_id));
        }
        if let Some(ref direction) = query.direction {
            select = select.filter(control_message::Column::Direction.eq(direction));
        }
        if let Some(ref msg_type) = query.message_type {
            select = select.filter(control_message::Column::MessageType.eq(msg_type));
        }
        if let Some(ref status) = query.status {
            select = select.filter(control_message::Column::Status.eq(status));
        }
        
        // 总数
        let total = select.clone().count(db).await?;
        
        // 分页 + 排序
        let offset = (query.page - 1) * query.page_size;
        let items = select
            .order_by_desc(control_message::Column::CreatedAt)
            .order_by_desc(control_message::Column::Id)
            .limit(query.page_size)
            .offset(offset)
            .all(db)
            .await?;
        
        Ok((items, total))
    }

    /// 根据 message_id 查询
    pub async fn find_by_message_id(
        db: &DatabaseConnection,
        message_id: &str,
    ) -> Result<Option<control_message::Model>, DbErr> {
        control_message::Entity::find()
            .filter(control_message::Column::MessageId.eq(message_id))
            .one(db)
            .await
    }

    /// 删除旧消息（保留期清理）
    /// 注意：SeaORM 的 delete_many 不支持 limit，需要先查询 ID 再批量删除
    pub async fn delete_before(
        db: &DatabaseConnection,
        before: chrono::NaiveDateTime,
        batch_size: u64,
    ) -> Result<u64, DbErr> {
        // 先查询要删除的 ID
        let ids: Vec<i32> = control_message::Entity::find()
            .filter(control_message::Column::CreatedAt.lt(before))
            .select_only()
            .column(control_message::Column::Id)
            .limit(batch_size)
            .into_tuple()
            .all(db)
            .await?;
        
        if ids.is_empty() {
            return Ok(0);
        }
        
        // 批量删除
        let result = control_message::Entity::delete_many()
            .filter(control_message::Column::Id.is_in(ids))
            .exec(db)
            .await?;
        
        Ok(result.rows_affected)
    }

    /// 统计各状态的消息数量
    pub async fn count_by_status(
        db: &DatabaseConnection,
    ) -> Result<Vec<(String, i64)>, DbErr> {
        use sea_orm::sea_query::Expr;
        
        let results = control_message::Entity::find()
            .select_only()
            .column(control_message::Column::Status)
            .column_as(Expr::col(control_message::Column::Id).count(), "count")
            .group_by(control_message::Column::Status)
            .into_tuple::<(String, i64)>()
            .all(db)
            .await?;
        
        Ok(results)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DbConfig, init_db, test_helper::create_test_schema};
    use chrono::Utc;

    #[tokio::test]
    async fn test_batch_insert_and_query() {
        let config = DbConfig::default();
        let db = init_db(&config).await.unwrap();
        create_test_schema(&db).await.unwrap();
        
        // 准备批量消息
        let now = Utc::now().naive_utc();
        let messages: Vec<control_message::ActiveModel> = (0..10)
            .map(|i| control_message::ActiveModel {
                message_id: Set(format!("msg-{}", i)),
                node_id: Set(Some("test-node".to_string())),
                direction: Set("worker_to_local".to_string()),
                message_type: Set("cache.get".to_string()),
                status: Set(if i % 2 == 0 { "success" } else { "failed" }.to_string()),
                request_cache_key: Set(Some(format!("key-{}", i))),
                payload_summary: Set(None),
                error_message: Set(None),
                duration_ms: Set(i as i32 * 10),
                created_at: Set(now),
                updated_at: Set(now),
                ..Default::default()
            })
            .collect();
        
        // 批量插入
        ControlMessageRepo::batch_insert(&db, messages).await.unwrap();
        
        // 分页查询
        let query = MessageQuery {
            page: 1,
            page_size: 5,
            node_id: Some("test-node".to_string()),
            ..Default::default()
        };
        
        let (items, total) = ControlMessageRepo::find_paginated(&db, &query)
            .await
            .unwrap();
        
        assert_eq!(total, 10);
        assert_eq!(items.len(), 5);
    }

    #[tokio::test]
    async fn test_count_by_status() {
        let config = DbConfig::default();
        let db = init_db(&config).await.unwrap();
        create_test_schema(&db).await.unwrap();
        
        // 插入测试数据
        let now = Utc::now().naive_utc();
        let messages: Vec<control_message::ActiveModel> = vec![
            control_message::ActiveModel {
                message_id: Set("msg-s1".to_string()),
                status: Set("success".to_string()),
                direction: Set("worker_to_local".to_string()),
                message_type: Set("cache.get".to_string()),
                duration_ms: Set(10),
                created_at: Set(now),
                updated_at: Set(now),
                ..Default::default()
            },
            control_message::ActiveModel {
                message_id: Set("msg-s2".to_string()),
                status: Set("success".to_string()),
                direction: Set("worker_to_local".to_string()),
                message_type: Set("cache.get".to_string()),
                duration_ms: Set(20),
                created_at: Set(now),
                updated_at: Set(now),
                ..Default::default()
            },
            control_message::ActiveModel {
                message_id: Set("msg-f1".to_string()),
                status: Set("failed".to_string()),
                direction: Set("worker_to_local".to_string()),
                message_type: Set("cache.get".to_string()),
                duration_ms: Set(30),
                created_at: Set(now),
                updated_at: Set(now),
                ..Default::default()
            },
        ];
        
        ControlMessageRepo::batch_insert(&db, messages).await.unwrap();
        
        // 统计
        let counts = ControlMessageRepo::count_by_status(&db).await.unwrap();
        
        assert!(counts.iter().any(|(s, c)| s == "success" && *c == 2));
        assert!(counts.iter().any(|(s, c)| s == "failed" && *c == 1));
    }
}
