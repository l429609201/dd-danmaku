use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tokio::time::{interval, Duration};
use tracing::{info, warn, error};
use uuid::Uuid;

use super::protocol::{BridgeMessage, ConnectionState, ConnectionMeta};

/// WebSocket 连接的发送通道
pub type WsSender = mpsc::UnboundedSender<BridgeMessage>;

/// 连接管理器
pub struct ConnectionManager {
    /// 所有活跃连接：connection_id -> (meta, sender)
    connections: Arc<RwLock<HashMap<String, (ConnectionMeta, WsSender)>>>,
    
    /// node_id -> connection_id 索引
    node_index: Arc<RwLock<HashMap<String, String>>>,
    
    /// 心跳间隔（秒）
    heartbeat_interval: u64,
    
    /// 心跳超时（秒）
    heartbeat_timeout: u64,
}

impl ConnectionManager {
    /// 创建新的连接管理器
    pub fn new(heartbeat_interval: u64, heartbeat_timeout: u64) -> Self {
        Self {
            connections: Arc::new(RwLock::new(HashMap::new())),
            node_index: Arc::new(RwLock::new(HashMap::new())),
            heartbeat_interval,
            heartbeat_timeout,
        }
    }
    
    /// 注册新连接
    pub async fn register(
        &self,
        node_id: String,
        worker_id: String,
        worker_url: String,
        protocol_version: String,
        client_version: Option<String>,
        sender: WsSender,
    ) -> Result<String, String> {
        let connection_id = Uuid::new_v4().to_string();
        
        let meta = ConnectionMeta::new(
            connection_id.clone(),
            node_id.clone(),
            worker_id,
            worker_url,
            protocol_version,
            client_version,
        );
        
        // 检查是否已有同 node_id 的连接
        let old_conn_id = {
            let node_idx = self.node_index.read().await;
            node_idx.get(&node_id).cloned()
        };
        
        if let Some(old_conn_id) = old_conn_id {
            // 关闭旧连接（不持有任何锁）
            warn!("Node {} already connected with {}, replacing", node_id, old_conn_id);
            self.disconnect_internal(&old_conn_id).await;
        }
        
        // 注册新连接
        {
            let mut node_idx = self.node_index.write().await;
            node_idx.insert(node_id.clone(), connection_id.clone());
        }
        
        {
            let mut conns = self.connections.write().await;
            conns.insert(connection_id.clone(), (meta.clone(), sender));
        }
        
        info!("Connection registered: {} (node: {})", connection_id, node_id);
        
        Ok(connection_id)
    }
    
    /// 断开连接
    pub async fn disconnect(&self, connection_id: &str) {
        self.disconnect_internal(connection_id).await;
    }
    
    async fn disconnect_internal(&self, connection_id: &str) {
        let mut conns = self.connections.write().await;
        
        if let Some((meta, _)) = conns.remove(connection_id) {
            info!("Connection disconnected: {} (node: {})", connection_id, meta.node_id);
            
            // 清理索引
            let mut node_idx = self.node_index.write().await;
            node_idx.remove(&meta.node_id);
        }
    }
    
    /// 通过 node_id 查找连接
    pub async fn find_by_node(&self, node_id: &str) -> Option<(ConnectionMeta, WsSender)> {
        let node_idx = self.node_index.read().await;
        let conn_id = node_idx.get(node_id)?;
        
        let conns = self.connections.read().await;
        conns.get(conn_id).cloned()
    }
    
    /// 发送消息到指定节点
    pub async fn send_to_node(&self, node_id: &str, msg: BridgeMessage) -> Result<(), String> {
        let (_, sender) = self.find_by_node(node_id).await
            .ok_or_else(|| format!("Node {} not connected", node_id))?;
        
        sender.send(msg)
            .map_err(|e| format!("Failed to send message: {}", e))
    }
    
    /// 通过 connection_id 发送消息
    pub async fn send_to_connection(&self, connection_id: &str, msg: BridgeMessage) -> Result<(), String> {
        let conns = self.connections.read().await;
        
        if let Some((_, sender)) = conns.get(connection_id) {
            sender
                .send(msg)
                .map_err(|e| format!("Failed to send message: {}", e))
        } else {
            Err(format!("Connection {} not found", connection_id))
        }
    }
    
    /// 更新心跳
    pub async fn update_heartbeat(&self, connection_id: &str, ping_timestamp: i64) -> Result<(), String> {
        let mut conns = self.connections.write().await;
        
        if let Some((meta, _)) = conns.get_mut(connection_id) {
            meta.update_pong(ping_timestamp);
            Ok(())
        } else {
            Err(format!("Connection {} not found", connection_id))
        }
    }
    
    /// 获取所有连接
    pub async fn list_connections(&self) -> Vec<ConnectionMeta> {
        let conns = self.connections.read().await;
        conns.values().map(|(meta, _)| meta.clone()).collect()
    }
    
    /// 获取连接数
    pub async fn connection_count(&self) -> usize {
        let conns = self.connections.read().await;
        conns.len()
    }
    
    /// 启动心跳检查任务
    pub fn start_heartbeat_checker(self: Arc<Self>) {
        let manager = Arc::clone(&self);
        
        tokio::spawn(async move {
            let mut tick = interval(Duration::from_secs(manager.heartbeat_interval));
            
            loop {
                tick.tick().await;
                manager.check_heartbeats().await;
            }
        });
    }
    
    /// 检查所有连接的心跳超时
    async fn check_heartbeats(&self) {
        use chrono::Utc;
        
        let timeout_threshold = Utc::now() - chrono::Duration::seconds(self.heartbeat_timeout as i64);
        let mut timeout_connections = Vec::new();
        
        {
            let conns = self.connections.read().await;
            
            for (conn_id, (meta, _)) in conns.iter() {
                // 如果没有收到过 pong，用连接时间判断
                let last_activity = meta.last_pong_at.unwrap_or(meta.connected_at);
                
                if last_activity < timeout_threshold {
                    warn!(
                        "Connection {} (node: {}) heartbeat timeout (last: {:?})",
                        conn_id, meta.node_id, last_activity
                    );
                    timeout_connections.push(conn_id.clone());
                }
            }
        }
        
        // 断开超时连接
        for conn_id in timeout_connections {
            self.disconnect(&conn_id).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_register_and_find() {
        let manager = ConnectionManager::new(30, 90);
        let (tx, _rx) = mpsc::unbounded_channel();
        
        let conn_id = manager.register(
            "node-1".to_string(),
            "worker-1".to_string(),
            "https://worker1.example.com".to_string(),
            "v1".to_string(),
            None,
            tx,
        ).await.unwrap();
        
        assert!(!conn_id.is_empty());
        
        let found = manager.find_by_node("node-1").await;
        assert!(found.is_some());
        
        let (meta, _) = found.unwrap();
        assert_eq!(meta.node_id, "node-1");
    }

    #[tokio::test]
    async fn test_disconnect() {
        let manager = ConnectionManager::new(30, 90);
        let (tx, _rx) = mpsc::unbounded_channel();
        
        let conn_id = manager.register(
            "node-2".to_string(),
            "worker-2".to_string(),
            "https://worker2.example.com".to_string(),
            "v1".to_string(),
            None,
            tx,
        ).await.unwrap();
        
        assert_eq!(manager.connection_count().await, 1);
        
        manager.disconnect(&conn_id).await;
        
        assert_eq!(manager.connection_count().await, 0);
        assert!(manager.find_by_node("node-2").await.is_none());
    }

    #[tokio::test]
    async fn test_replace_existing_connection() {
        let manager = ConnectionManager::new(30, 90);
        let (tx1, _rx1) = mpsc::unbounded_channel();
        let (tx2, _rx2) = mpsc::unbounded_channel();
        
        // 第一次注册
        let conn_id1 = manager.register(
            "node-3".to_string(),
            "worker-3".to_string(),
            "https://worker3.example.com".to_string(),
            "v1".to_string(),
            None,
            tx1,
        ).await.unwrap();
        
        // 同 node_id 第二次注册
        let conn_id2 = manager.register(
            "node-3".to_string(),
            "worker-3".to_string(),
            "https://worker3.example.com".to_string(),
            "v1".to_string(),
            None,
            tx2,
        ).await.unwrap();
        
        assert_ne!(conn_id1, conn_id2);
        assert_eq!(manager.connection_count().await, 1);
        
        // 只有新连接可以找到
        let found = manager.find_by_node("node-3").await.unwrap();
        assert_eq!(found.0.connection_id, conn_id2);
    }
}
