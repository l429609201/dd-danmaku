use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 官方凭据只读投影；永不包含原始密钥或加密信封。
#[derive(Serialize, Deserialize)]
pub struct DandanplayConfigResponse {
    pub app_id: String,
    pub user_agent: String,
    pub secret_configured: bool,
    pub source: String,
    pub encryption_ready: bool,
}

/// 不提供清空操作；省略或 null 保留已有数据库密钥，禁止 Debug 打印请求。
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateDandanplayConfigRequest {
    pub app_id: String,
    pub user_agent: String,
    pub app_secret: Option<String>,
}

/// 系统配置项
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigItem {
    pub namespace: String,
    pub key: String,
    pub value: String,
    pub description: Option<String>,
    pub updated_at: String,
    pub is_secret: bool,
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
    pub uptime_seconds: Option<u64>,
}

/// 系统统计
#[derive(Debug, Serialize)]
pub struct SystemStats {
    pub version: String,
    pub rust_version: Option<String>,
    pub build_time: Option<String>,
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
    pub max_connections: Option<u32>,
    pub min_connections: Option<u32>,
}

/// 缓存配置
#[derive(Debug, Serialize, Deserialize)]
pub struct CacheConfig {
    /// 仅投影已生效的进程模式；此字段不属于可写配置。
    pub run_mode: crate::RunMode,
    pub enabled: bool,
    pub ttl_seconds: Option<u32>,
    pub max_entries: Option<u32>,
    pub redis_enabled: bool,
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
            is_secret: false,
        };
        
        let json = serde_json::to_string(&item).unwrap();
        assert!(json.contains("system"));
        assert!(json.contains("site_name"));
    }
}
