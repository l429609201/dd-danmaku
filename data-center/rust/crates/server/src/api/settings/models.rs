use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 系统配置项
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigItem {
    pub namespace: String,
    pub key: String,
    pub value: String,
    pub description: Option<String>,
    pub updated_at: String,
}

/// 获取配置请求
#[derive(Debug, Deserialize)]
pub struct GetConfigQuery {
    pub namespace: Option<String>,
}

/// 更新配置请求
#[derive(Debug, Deserialize)]
pub struct UpdateConfigRequest {
    pub configs: Vec<UpdateConfigItem>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateConfigItem {
    pub namespace: String,
    pub key: String,
    pub value: String,
}

/// 配置列表响应
#[derive(Debug, Serialize)]
pub struct ConfigListResponse {
    pub configs: Vec<ConfigItem>,
    pub total: usize,
}

/// Dashboard 统计
#[derive(Debug, Serialize)]
pub struct DashboardStats {
    pub system: SystemStats,
    pub worker: WorkerStats,
    pub cache: CacheStats,
    pub danmaku: DanmakuStats,
    pub uptime_seconds: u64,
}

/// 系统统计
#[derive(Debug, Serialize)]
pub struct SystemStats {
    pub version: String,
    pub rust_version: String,
    pub build_time: String,
    pub os: String,
    pub arch: String,
    pub cpu_usage: Option<f32>,
    pub memory_used_mb: Option<u64>,
    pub memory_total_mb: Option<u64>,
}

/// Worker 统计
#[derive(Debug, Serialize)]
pub struct WorkerStats {
    pub total_nodes: u64,
    pub online_nodes: u64,
    pub total_messages: u64,
    pub recent_events: u64,
}

/// 缓存统计
#[derive(Debug, Serialize)]
pub struct CacheStats {
    pub total_entries: u64,
    pub hit_rate: Option<f32>,
    pub total_size_mb: Option<f32>,
}

/// 弹幕统计
#[derive(Debug, Serialize)]
pub struct DanmakuStats {
    pub total_episodes: u64,
    pub total_comments: u64,
    pub total_size_mb: f32,
}

/// 健康检查详情
#[derive(Debug, Serialize)]
pub struct HealthCheckResponse {
    pub status: String,
    pub database: HealthStatus,
    pub cache: HealthStatus,
    pub storage: HealthStatus,
    pub timestamp: String,
}

#[derive(Debug, Serialize)]
pub struct HealthStatus {
    pub status: String,
    pub message: Option<String>,
    pub latency_ms: Option<u64>,
}

/// 数据库配置
#[derive(Debug, Serialize, Deserialize)]
pub struct DatabaseConfig {
    pub url: String, // 敏感信息，需要脱敏
    pub max_connections: u32,
    pub min_connections: u32,
}

/// 缓存配置
#[derive(Debug, Serialize, Deserialize)]
pub struct CacheConfig {
    pub enabled: bool,
    pub ttl_seconds: u32,
    pub max_entries: u32,
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_config_item_serialize() {
        let item = ConfigItem {
            namespace: "system".to_string(),
            key: "site_name".to_string(),
            value: "DataCenter".to_string(),
            description: Some("网站名称".to_string()),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        };
        
        let json = serde_json::to_string(&item).unwrap();
        assert!(json.contains("system"));
        assert!(json.contains("site_name"));
    }
}
