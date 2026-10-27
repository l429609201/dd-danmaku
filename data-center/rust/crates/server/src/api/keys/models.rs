use serde::{Deserialize, Serialize};

// ==================== 阶段 5: 密钥和安全 ====================

/// API 密钥信息
#[derive(Debug, Clone, Serialize)]
pub struct ApiKeyInfo {
    pub id: i64,
    pub name: String,
    pub api_key: String, // 实际使用时应该脱敏
    pub source: String,
    pub is_active: bool,
    pub priority: i32,
    pub last_used_at: Option<String>,
    pub use_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateApiKeyRequest {
    pub name: String,
    pub api_key: String,
    pub source: String,
    pub priority: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateApiKeyRequest {
    pub name: Option<String>,
    pub api_key: Option<String>,
    pub source: Option<String>,
    pub is_active: Option<bool>,
    pub priority: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct ApiKeyListResponse {
    pub keys: Vec<ApiKeyInfo>,
    pub total: u64,
    pub page: u64,
    pub page_size: u64,
}

/// 签名密钥信息
#[derive(Debug, Clone, Serialize)]
pub struct SignKeyInfo {
    pub id: i64,
    pub name: String,
    pub sign_key: String, // 实际使用时应该脱敏
    pub purpose: String,
    pub is_active: bool,
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateSignKeyRequest {
    pub name: String,
    pub sign_key: String,
    pub purpose: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSignKeyRequest {
    pub name: Option<String>,
    pub sign_key: Option<String>,
    pub purpose: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct SignKeyListResponse {
    pub keys: Vec<SignKeyInfo>,
    pub total: u64,
    pub page: u64,
    pub page_size: u64,
}

/// 用户白名单信息
#[derive(Debug, Clone, Serialize)]
pub struct UserAllowInfo {
    pub id: i64,
    pub user_identifier: String,
    pub user_type: String,
    pub description: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateUserAllowRequest {
    pub user_identifier: String,
    pub user_type: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserAllowRequest {
    pub user_type: Option<String>,
    pub description: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct UserAllowListResponse {
    pub users: Vec<UserAllowInfo>,
    pub total: u64,
    pub page: u64,
    pub page_size: u64,
}

/// OAuth 配置信息
#[derive(Debug, Clone, Serialize)]
pub struct OAuthConfigInfo {
    pub id: i64,
    pub provider: String,
    pub client_id: String,
    pub client_secret: String, // 实际使用时应该脱敏
    pub redirect_uri: String,
    pub scope: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateOAuthConfigRequest {
    pub provider: String,
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub scope: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateOAuthConfigRequest {
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
    pub redirect_uri: Option<String>,
    pub scope: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct OAuthConfigListResponse {
    pub configs: Vec<OAuthConfigInfo>,
}

// ==================== 阶段 6: 日志和监控 ====================

/// Worker 日志信息
#[derive(Debug, Clone, Serialize)]
pub struct WorkerLogInfo {
    pub id: i64,
    pub node_id: Option<String>,
    pub level: String,
    pub message: String,
    pub extra_data: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct WorkerLogQuery {
    #[serde(default = "default_page")]
    pub page: u64,
    #[serde(default = "default_page_size")]
    pub page_size: u64,
    pub level: Option<String>,
    pub node_id: Option<String>,
}

fn default_page() -> u64 { 1 }
fn default_page_size() -> u64 { 50 }

#[derive(Debug, Serialize)]
pub struct WorkerLogListResponse {
    pub logs: Vec<WorkerLogInfo>,
    pub total: u64,
    pub page: u64,
    pub page_size: u64,
}

/// IP 统计信息
#[derive(Debug, Clone, Serialize)]
pub struct IpStatInfo {
    pub id: i64,
    pub ip_address: String,
    pub path: String,
    pub method: String,
    pub status_code: i32,
    pub user_agent: Option<String>,
    pub request_time: String,
    pub response_time_ms: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct IpStatsQuery {
    #[serde(default = "default_page")]
    pub page: u64,
    #[serde(default = "default_page_size")]
    pub page_size: u64,
    pub ip: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct IpStatsListResponse {
    pub stats: Vec<IpStatInfo>,
    pub total: u64,
    pub page: u64,
    pub page_size: u64,
}

#[derive(Debug, Serialize)]
pub struct IpStatsAggregateResponse {
    pub top_ips: Vec<IpStatAggregate>,
}

#[derive(Debug, Serialize)]
pub struct IpStatAggregate {
    pub ip_address: String,
    pub request_count: i64,
}

// ==================== 阶段 7: 数据清理 ====================

/// 清理策略信息
#[derive(Debug, Clone, Serialize)]
pub struct CleanupPolicyInfo {
    pub id: i64,
    pub name: String,
    pub target_table: String,
    pub condition: String,
    pub retention_days: i32,
    pub is_active: bool,
    pub schedule: String,
    pub last_run_at: Option<String>,
    pub last_cleanup_count: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateCleanupPolicyRequest {
    pub name: String,
    pub target_table: String,
    pub condition: String,
    pub retention_days: i32,
    pub schedule: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCleanupPolicyRequest {
    pub name: Option<String>,
    pub condition: Option<String>,
    pub retention_days: Option<i32>,
    pub is_active: Option<bool>,
    pub schedule: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CleanupPolicyListResponse {
    pub policies: Vec<CleanupPolicyInfo>,
}

#[derive(Debug, Deserialize)]
pub struct ExecuteCleanupRequest {
    pub policy_id: i64,
}

#[derive(Debug, Serialize)]
pub struct CleanupExecutionResponse {
    pub policy_id: i64,
    pub deleted_count: u64,
    pub executed_at: String,
}
