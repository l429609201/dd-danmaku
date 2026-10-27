use serde::{Deserialize, Serialize};

/// IP 规则信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpRuleInfo {
    pub id: i64,
    pub ip_pattern: String,
    pub rule_type: String, // "allow" or "deny"
    pub description: Option<String>,
    pub is_active: bool,
    pub priority: i32,
    pub created_at: String,
    pub updated_at: String,
}

/// 创建 IP 规则请求
#[derive(Debug, Clone, Deserialize)]
pub struct CreateIpRuleRequest {
    pub ip_pattern: String,
    pub rule_type: String, // "allow" or "deny"
    pub description: Option<String>,
    pub priority: Option<i32>,
}

/// 更新 IP 规则请求
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateIpRuleRequest {
    pub ip_pattern: Option<String>,
    pub rule_type: Option<String>,
    pub description: Option<String>,
    pub is_active: Option<bool>,
    pub priority: Option<i32>,
}

/// IP 规则列表响应
#[derive(Debug, Clone, Serialize)]
pub struct IpRuleListResponse {
    pub rules: Vec<IpRuleInfo>,
    pub total: u64,
    pub page: u64,
    pub page_size: u64,
}

/// 批量操作请求
#[derive(Debug, Clone, Deserialize)]
pub struct BatchOperationRequest {
    pub ids: Vec<i64>,
    pub action: String, // "enable" or "disable"
}

/// User-Agent 规则信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UaRuleInfo {
    pub id: i64,
    pub ua_pattern: String,
    pub rule_type: String, // "allow" or "deny"
    pub description: Option<String>,
    pub is_active: bool,
    pub priority: i32,
    pub created_at: String,
    pub updated_at: String,
}

/// 创建 UA 规则请求
#[derive(Debug, Clone, Deserialize)]
pub struct CreateUaRuleRequest {
    pub ua_pattern: String,
    pub rule_type: String, // "allow" or "deny"
    pub description: Option<String>,
    pub priority: Option<i32>,
}

/// 更新 UA 规则请求
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateUaRuleRequest {
    pub ua_pattern: Option<String>,
    pub rule_type: Option<String>,
    pub description: Option<String>,
    pub is_active: Option<bool>,
    pub priority: Option<i32>,
}

/// UA 规则列表响应
#[derive(Debug, Clone, Serialize)]
pub struct UaRuleListResponse {
    pub rules: Vec<UaRuleInfo>,
    pub total: u64,
    pub page: u64,
    pub page_size: u64,
}
