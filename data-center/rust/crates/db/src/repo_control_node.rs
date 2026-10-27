use sea_orm::*;
use sea_orm::sea_query::Expr;
use crate::entities::control_node;

/// control_nodes 表的数据访问层
pub struct ControlNodeRepo;

impl ControlNodeRepo {
    /// 根据 node_id 查询节点
    pub async fn find_by_node_id(
        db: &DatabaseConnection,
        node_id: &str,
    ) -> Result<Option<control_node::Model>, DbErr> {
        control_node::Entity::find()
            .filter(control_node::Column::NodeId.eq(node_id))
            .one(db)
            .await
    }

    /// 创建或更新节点
    pub async fn upsert(
        db: &DatabaseConnection,
        node_id: String,
        worker_id: String,
        worker_url: String,
        connected: bool,
    ) -> Result<control_node::Model, DbErr> {
        use chrono::Utc;

        // 先尝试查找
        if let Some(existing) = Self::find_by_node_id(db, &node_id).await? {
            // 更新现有节点
            let mut active: control_node::ActiveModel = existing.into();
            active.worker_id = Set(worker_id);
            active.worker_url = Set(worker_url);
            active.connected = Set(connected);
            active.last_seen_at = Set(Some(Utc::now().naive_utc()));
            active.updated_at = Set(Utc::now().naive_utc());
            
            if connected {
                active.last_connected_at = Set(Some(Utc::now().naive_utc()));
            }
            
            active.update(db).await
        } else {
            // 创建新节点
            let now = Utc::now().naive_utc();
            let new_node = control_node::ActiveModel {
                node_id: Set(node_id),
                worker_id: Set(worker_id),
                worker_url: Set(worker_url),
                connected: Set(connected),
                connection_id: Set(None),
                protocol_version: Set("v1".to_string()),
                client_version: Set(None),
                last_connected_at: Set(if connected { Some(now) } else { None }),
                last_seen_at: Set(Some(now)),
                latency_ms: Set(0),
                reconnect_count: Set(0),
                last_error: Set(None),
                extra_json: Set(None),
                created_at: Set(now),
                updated_at: Set(now),
                ..Default::default()
            };
            
            new_node.insert(db).await
        }
    }

    /// 更新节点心跳
    pub async fn update_heartbeat(
        db: &DatabaseConnection,
        node_id: &str,
        latency_ms: i32,
    ) -> Result<(), DbErr> {
        use chrono::Utc;
        
        control_node::Entity::update_many()
            .filter(control_node::Column::NodeId.eq(node_id))
            .col_expr(control_node::Column::LastSeenAt, Expr::value(Utc::now().naive_utc()))
            .col_expr(control_node::Column::LatencyMs, Expr::value(latency_ms))
            .exec(db)
            .await?;
        
        Ok(())
    }

    /// 标记节点断开
    pub async fn mark_disconnected(
        db: &DatabaseConnection,
        node_id: &str,
        error: Option<String>,
    ) -> Result<(), DbErr> {
        use chrono::Utc;
        
        let mut update = control_node::Entity::update_many()
            .filter(control_node::Column::NodeId.eq(node_id))
            .col_expr(control_node::Column::Connected, Expr::value(false))
            .col_expr(control_node::Column::UpdatedAt, Expr::value(Utc::now().naive_utc()));
        
        if let Some(err) = error {
            update = update.col_expr(control_node::Column::LastError, Expr::value(err));
        }
        
        update.exec(db).await?;
        Ok(())
    }

    /// 增加重连计数
    pub async fn increment_reconnect_count(
        db: &DatabaseConnection,
        node_id: &str,
    ) -> Result<(), DbErr> {
        control_node::Entity::update_many()
            .filter(control_node::Column::NodeId.eq(node_id))
            .col_expr(
                control_node::Column::ReconnectCount,
                Expr::col(control_node::Column::ReconnectCount).add(1),
            )
            .exec(db)
            .await?;
        
        Ok(())
    }

    /// 列出所有节点
    pub async fn list_all(
        db: &DatabaseConnection,
    ) -> Result<Vec<control_node::Model>, DbErr> {
        control_node::Entity::find()
            .order_by_desc(control_node::Column::LastSeenAt)
            .all(db)
            .await
    }

    /// 列出在线节点
    pub async fn list_connected(
        db: &DatabaseConnection,
    ) -> Result<Vec<control_node::Model>, DbErr> {
        control_node::Entity::find()
            .filter(control_node::Column::Connected.eq(true))
            .order_by_desc(control_node::Column::LastSeenAt)
            .all(db)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DbConfig, init_db, test_helper::create_test_schema};

    #[tokio::test]
    async fn test_upsert_and_find() {
        let config = DbConfig::default();
        let db = init_db(&config).await.unwrap();
        create_test_schema(&db).await.unwrap();
        
        // 创建节点
        let node = ControlNodeRepo::upsert(
            &db,
            "test-node-1".to_string(),
            "worker-1".to_string(),
            "https://worker1.example.com".to_string(),
            true,
        )
        .await
        .unwrap();
        
        assert_eq!(node.node_id, "test-node-1");
        assert_eq!(node.connected, true);
        
        // 查询节点
        let found = ControlNodeRepo::find_by_node_id(&db, "test-node-1")
            .await
            .unwrap();
        
        assert!(found.is_some());
        assert_eq!(found.unwrap().node_id, "test-node-1");
    }

    #[tokio::test]
    async fn test_heartbeat() {
        let config = DbConfig::default();
        let db = init_db(&config).await.unwrap();
        create_test_schema(&db).await.unwrap();
        
        // 创建节点
        ControlNodeRepo::upsert(
            &db,
            "test-node-2".to_string(),
            "worker-2".to_string(),
            "https://worker2.example.com".to_string(),
            true,
        )
        .await
        .unwrap();
        
        // 更新心跳
        ControlNodeRepo::update_heartbeat(&db, "test-node-2", 50)
            .await
            .unwrap();
        
        // 验证延迟已更新
        let node = ControlNodeRepo::find_by_node_id(&db, "test-node-2")
            .await
            .unwrap()
            .unwrap();
        
        assert_eq!(node.latency_ms, 50);
    }
}
