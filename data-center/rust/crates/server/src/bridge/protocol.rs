use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

/// Worker Bridge 消息类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BridgeMessage {
    /// 心跳 ping
    Ping {
        timestamp: i64,
    },
    
    /// 心跳 pong
    Pong {
        timestamp: i64,
    },
    
    /// Worker 注册
    Register {
        node_id: String,
        worker_id: String,
        worker_url: String,
        protocol_version: String,
        client_version: Option<String>,
    },
    
    /// 注册响应
    RegisterAck {
        success: bool,
        message: Option<String>,
        connection_id: Option<String>,
    },
    
    /// 缓存查询请求（Local → Worker）
    CacheGet {
        message_id: String,
        cache_key: String,
    },
    
    /// 缓存查询响应（Worker → Local）
    CacheGetResult {
        message_id: String,
        cache_key: String,
        found: bool,
        value: Option<serde_json::Value>,
    },
    
    /// 通用错误
    Error {
        message_id: Option<String>,
        error_code: String,
        error_message: String,
    },
}

impl BridgeMessage {
    /// 获取消息 ID（如果有）
    pub fn message_id(&self) -> Option<&str> {
        match self {
            BridgeMessage::CacheGet { message_id, .. } => Some(message_id),
            BridgeMessage::CacheGetResult { message_id, .. } => Some(message_id),
            BridgeMessage::Error { message_id, .. } => message_id.as_deref(),
            _ => None,
        }
    }
    
    /// 是否是心跳消息
    pub fn is_heartbeat(&self) -> bool {
        matches!(self, BridgeMessage::Ping { .. } | BridgeMessage::Pong { .. })
    }
}

/// 连接状态
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    /// 等待注册
    Idle,
    /// 已注册，正常通信
    Connected,
    /// 断开连接
    Disconnected,
}

/// 连接元数据
#[derive(Debug, Clone)]
pub struct ConnectionMeta {
    pub connection_id: String,
    pub node_id: String,
    pub worker_id: String,
    pub worker_url: String,
    pub protocol_version: String,
    pub client_version: Option<String>,
    pub connected_at: DateTime<Utc>,
    pub last_ping_at: Option<DateTime<Utc>>,
    pub last_pong_at: Option<DateTime<Utc>>,
    pub latency_ms: Option<i64>,
}

impl ConnectionMeta {
    pub fn new(
        connection_id: String,
        node_id: String,
        worker_id: String,
        worker_url: String,
        protocol_version: String,
        client_version: Option<String>,
    ) -> Self {
        Self {
            connection_id,
            node_id,
            worker_id,
            worker_url,
            protocol_version,
            client_version,
            connected_at: Utc::now(),
            last_ping_at: None,
            last_pong_at: None,
            latency_ms: None,
        }
    }
    
    /// 更新心跳时间
    pub fn update_pong(&mut self, ping_timestamp: i64) {
        let now = Utc::now();
        self.last_pong_at = Some(now);
        
        // 计算延迟
        let pong_ts = now.timestamp_millis();
        self.latency_ms = Some(pong_ts - ping_timestamp);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_serialization() {
        let msg = BridgeMessage::Ping {
            timestamp: 1234567890,
        };
        
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"ping\""));
        
        let decoded: BridgeMessage = serde_json::from_str(&json).unwrap();
        assert!(matches!(decoded, BridgeMessage::Ping { .. }));
    }

    #[test]
    fn test_message_id_extraction() {
        let msg = BridgeMessage::CacheGet {
            message_id: "msg-123".to_string(),
            cache_key: "key-1".to_string(),
        };
        
        assert_eq!(msg.message_id(), Some("msg-123"));
        
        let ping = BridgeMessage::Ping { timestamp: 0 };
        assert_eq!(ping.message_id(), None);
    }

    #[test]
    fn test_is_heartbeat() {
        assert!(BridgeMessage::Ping { timestamp: 0 }.is_heartbeat());
        assert!(BridgeMessage::Pong { timestamp: 0 }.is_heartbeat());
        
        let cache = BridgeMessage::CacheGet {
            message_id: "m1".to_string(),
            cache_key: "k1".to_string(),
        };
        assert!(!cache.is_heartbeat());
    }

    #[test]
    fn test_connection_meta_latency() {
        let mut meta = ConnectionMeta::new(
            "conn-1".to_string(),
            "node-1".to_string(),
            "worker-1".to_string(),
            "https://worker1.example.com".to_string(),
            "v1".to_string(),
            None,
        );
        
        let ping_ts = Utc::now().timestamp_millis() - 50; // 50ms ago
        meta.update_pong(ping_ts);
        
        assert!(meta.last_pong_at.is_some());
        assert!(meta.latency_ms.unwrap() >= 50);
    }
}
