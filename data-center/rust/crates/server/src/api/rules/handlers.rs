use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::AppState;
use super::models::*;

/// 保留内部错误日志，同时将不存在的更新映射为 404。
fn rule_db_err(error: sea_orm::DbErr) -> StatusCode {
    if matches!(error, sea_orm::DbErr::RecordNotFound(_)) {
        return StatusCode::NOT_FOUND;
    }
    tracing::error!(error = %error, "规则数据库操作失败");
    StatusCode::INTERNAL_SERVER_ERROR
}

/// IP 规则仅接受有效的 IPv4/IPv6 地址或 CIDR，不允许空匹配意外影响所有用户。
fn valid_ip_pattern(pattern: &str) -> bool {
    if let Some((address, prefix)) = pattern.split_once('/') {
        let Ok(address) = address.parse::<std::net::IpAddr>() else { return false; };
        let Ok(prefix) = prefix.parse::<u8>() else { return false; };
        prefix <= if address.is_ipv4() { 32 } else { 128 }
    } else {
        pattern.parse::<std::net::IpAddr>().is_ok()
    }
}

/// 分页查询参数
#[derive(Debug, Deserialize)]
pub struct PaginationQuery {
    #[serde(default = "default_page")]
    pub page: u64,
    #[serde(default = "default_page_size")]
    pub page_size: u64,
}

fn default_page() -> u64 {
    1
}

fn default_page_size() -> u64 {
    20
}

/// 获取 IP 规则列表
pub async fn get_ip_rules(
    State(state): State<Arc<AppState>>,
    Query(params): Query<PaginationQuery>,
) -> Result<Json<IpRuleListResponse>, StatusCode> {
    let page = params.page.max(1);
    let page_size = params.page_size.clamp(1, 100);
    // OFFSET 为有符号整数，拒绝极端分页参数而不是算术溢出。
    let offset = (page - 1).checked_mul(page_size)
        .filter(|offset| *offset <= i64::MAX as u64)
        .ok_or(StatusCode::BAD_REQUEST)?;
    
    let (rules, total) = db::IpRuleRepo::find_all(&state.db, offset, page_size)
        .await
        .map_err(rule_db_err)?;
    
    let rule_infos: Vec<IpRuleInfo> = rules
        .into_iter()
        .map(|r| IpRuleInfo {
            id: r.id,
            ip_pattern: r.ip_pattern,
            rule_type: match r.rule_type {
                db::entities::ip_rule::IpRuleType::Allow => "allow".to_string(),
                db::entities::ip_rule::IpRuleType::Deny => "deny".to_string(),
            },
            description: r.description,
            is_active: r.is_active,
            priority: r.priority,
            created_at: r.created_at.and_utc().to_rfc3339(),
            updated_at: r.updated_at.and_utc().to_rfc3339(),
        })
        .collect();
    
    Ok(Json(IpRuleListResponse {
        rules: rule_infos,
        total,
        page,
        page_size,
    }))
}

/// 获取单个 IP 规则
pub async fn get_ip_rule(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<Json<IpRuleInfo>, StatusCode> {
    let rule = db::IpRuleRepo::find_by_id(&state.db, id)
        .await
        .map_err(rule_db_err)?
        .ok_or(StatusCode::NOT_FOUND)?;
    
    Ok(Json(IpRuleInfo {
        id: rule.id,
        ip_pattern: rule.ip_pattern,
        rule_type: match rule.rule_type {
            db::entities::ip_rule::IpRuleType::Allow => "allow".to_string(),
            db::entities::ip_rule::IpRuleType::Deny => "deny".to_string(),
        },
        description: rule.description,
        is_active: rule.is_active,
        priority: rule.priority,
        created_at: rule.created_at.and_utc().to_rfc3339(),
        updated_at: rule.updated_at.and_utc().to_rfc3339(),
    }))
}

/// 创建 IP 规则
pub async fn create_ip_rule(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateIpRuleRequest>,
) -> Result<Json<IpRuleInfo>, StatusCode> {
    // 在访问数据库前拒绝无效匹配模式。
    if !valid_ip_pattern(req.ip_pattern.trim()) {
        return Err(StatusCode::BAD_REQUEST);
    }
    // 验证 rule_type
    let rule_type = match req.rule_type.as_str() {
        "allow" => db::entities::ip_rule::IpRuleType::Allow,
        "deny" => db::entities::ip_rule::IpRuleType::Deny,
        _ => return Err(StatusCode::BAD_REQUEST),
    };
    
    let priority = req.priority.unwrap_or(100);
    
    let rule = db::IpRuleRepo::create(
        &state.db,
        req.ip_pattern.trim().to_string(),
        rule_type,
        req.description,
        priority,
    )
    .await
    .map_err(rule_db_err)?;
    
    Ok(Json(IpRuleInfo {
        id: rule.id,
        ip_pattern: rule.ip_pattern,
        rule_type: match rule.rule_type {
            db::entities::ip_rule::IpRuleType::Allow => "allow".to_string(),
            db::entities::ip_rule::IpRuleType::Deny => "deny".to_string(),
        },
        description: rule.description,
        is_active: rule.is_active,
        priority: rule.priority,
        created_at: rule.created_at.and_utc().to_rfc3339(),
        updated_at: rule.updated_at.and_utc().to_rfc3339(),
    }))
}

/// 更新 IP 规则
pub async fn update_ip_rule(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(req): Json<UpdateIpRuleRequest>,
) -> Result<Json<IpRuleInfo>, StatusCode> {
    // 在访问数据库前拒绝无效匹配模式。
    if req.ip_pattern.as_ref().is_some_and(|pattern| !valid_ip_pattern(pattern.trim())) {
        return Err(StatusCode::BAD_REQUEST);
    }
    // 验证 rule_type
    let rule_type = if let Some(ref rt) = req.rule_type {
        Some(match rt.as_str() {
            "allow" => db::entities::ip_rule::IpRuleType::Allow,
            "deny" => db::entities::ip_rule::IpRuleType::Deny,
            _ => return Err(StatusCode::BAD_REQUEST),
        })
    } else {
        None
    };
    
    let rule = db::IpRuleRepo::update(
        &state.db,
        id,
        req.ip_pattern.map(|pattern| pattern.trim().to_string()),
        rule_type,
        req.description,
        req.is_active,
        req.priority,
    )
    .await
    .map_err(rule_db_err)?;
    
    Ok(Json(IpRuleInfo {
        id: rule.id,
        ip_pattern: rule.ip_pattern,
        rule_type: match rule.rule_type {
            db::entities::ip_rule::IpRuleType::Allow => "allow".to_string(),
            db::entities::ip_rule::IpRuleType::Deny => "deny".to_string(),
        },
        description: rule.description,
        is_active: rule.is_active,
        priority: rule.priority,
        created_at: rule.created_at.and_utc().to_rfc3339(),
        updated_at: rule.updated_at.and_utc().to_rfc3339(),
    }))
}

/// 删除 IP 规则
pub async fn delete_ip_rule(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<StatusCode, StatusCode> {
    let deleted = db::IpRuleRepo::delete(&state.db, id)
        .await
        .map_err(rule_db_err)?;
    
    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

/// 批量启用/禁用 IP 规则
pub async fn batch_ip_rules(
    State(state): State<Arc<AppState>>,
    Json(req): Json<BatchOperationRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let is_active = match req.action.as_str() {
        "enable" => true,
        "disable" => false,
        _ => return Err(StatusCode::BAD_REQUEST),
    };
    
    let affected = db::IpRuleRepo::batch_set_active(&state.db, req.ids, is_active)
        .await
        .map_err(rule_db_err)?;
    
    Ok(Json(serde_json::json!({
        "affected": affected
    })))
}

/// 获取 UA 规则列表
pub async fn get_ua_rules(
    State(state): State<Arc<AppState>>,
    Query(params): Query<PaginationQuery>,
) -> Result<Json<UaRuleListResponse>, StatusCode> {
    let page = params.page.max(1);
    let page_size = params.page_size.clamp(1, 100);
    // OFFSET 为有符号整数，拒绝极端分页参数而不是算术溢出。
    let offset = (page - 1).checked_mul(page_size)
        .filter(|offset| *offset <= i64::MAX as u64)
        .ok_or(StatusCode::BAD_REQUEST)?;
    
    let (rules, total) = db::UaRuleRepo::find_all(&state.db, offset, page_size)
        .await
        .map_err(rule_db_err)?;
    
    let rule_infos: Vec<UaRuleInfo> = rules
        .into_iter()
        .map(|r| UaRuleInfo {
            id: r.id,
            ua_pattern: r.ua_pattern,
            rule_type: match r.rule_type {
                db::entities::ua_rule::UaRuleType::Allow => "allow".to_string(),
                db::entities::ua_rule::UaRuleType::Deny => "deny".to_string(),
            },
            description: r.description,
            is_active: r.is_active,
            priority: r.priority,
            created_at: r.created_at.and_utc().to_rfc3339(),
            updated_at: r.updated_at.and_utc().to_rfc3339(),
        })
        .collect();
    
    Ok(Json(UaRuleListResponse {
        rules: rule_infos,
        total,
        page,
        page_size,
    }))
}

/// 获取单个 UA 规则
pub async fn get_ua_rule(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<Json<UaRuleInfo>, StatusCode> {
    let rule = db::UaRuleRepo::find_by_id(&state.db, id)
        .await
        .map_err(rule_db_err)?
        .ok_or(StatusCode::NOT_FOUND)?;
    
    Ok(Json(UaRuleInfo {
        id: rule.id,
        ua_pattern: rule.ua_pattern,
        rule_type: match rule.rule_type {
            db::entities::ua_rule::UaRuleType::Allow => "allow".to_string(),
            db::entities::ua_rule::UaRuleType::Deny => "deny".to_string(),
        },
        description: rule.description,
        is_active: rule.is_active,
        priority: rule.priority,
        created_at: rule.created_at.and_utc().to_rfc3339(),
        updated_at: rule.updated_at.and_utc().to_rfc3339(),
    }))
}

/// 创建 UA 规则
pub async fn create_ua_rule(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateUaRuleRequest>,
) -> Result<Json<UaRuleInfo>, StatusCode> {
    // 在访问数据库前拒绝无效匹配模式。
    if req.ua_pattern.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    // 验证 rule_type
    let rule_type = match req.rule_type.as_str() {
        "allow" => db::entities::ua_rule::UaRuleType::Allow,
        "deny" => db::entities::ua_rule::UaRuleType::Deny,
        _ => return Err(StatusCode::BAD_REQUEST),
    };
    
    let priority = req.priority.unwrap_or(100);
    
    let rule = db::UaRuleRepo::create(
        &state.db,
        req.ua_pattern,
        rule_type,
        req.description,
        priority,
    )
    .await
    .map_err(rule_db_err)?;
    
    Ok(Json(UaRuleInfo {
        id: rule.id,
        ua_pattern: rule.ua_pattern,
        rule_type: match rule.rule_type {
            db::entities::ua_rule::UaRuleType::Allow => "allow".to_string(),
            db::entities::ua_rule::UaRuleType::Deny => "deny".to_string(),
        },
        description: rule.description,
        is_active: rule.is_active,
        priority: rule.priority,
        created_at: rule.created_at.and_utc().to_rfc3339(),
        updated_at: rule.updated_at.and_utc().to_rfc3339(),
    }))
}

/// 更新 UA 规则
pub async fn update_ua_rule(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(req): Json<UpdateUaRuleRequest>,
) -> Result<Json<UaRuleInfo>, StatusCode> {
    // 在访问数据库前拒绝无效匹配模式。
    if req.ua_pattern.as_ref().is_some_and(|pattern| pattern.trim().is_empty()) {
        return Err(StatusCode::BAD_REQUEST);
    }
    // 验证 rule_type
    let rule_type = if let Some(ref rt) = req.rule_type {
        Some(match rt.as_str() {
            "allow" => db::entities::ua_rule::UaRuleType::Allow,
            "deny" => db::entities::ua_rule::UaRuleType::Deny,
            _ => return Err(StatusCode::BAD_REQUEST),
        })
    } else {
        None
    };
    
    let rule = db::UaRuleRepo::update(
        &state.db,
        id,
        req.ua_pattern,
        rule_type,
        req.description,
        req.is_active,
        req.priority,
    )
    .await
    .map_err(rule_db_err)?;
    
    Ok(Json(UaRuleInfo {
        id: rule.id,
        ua_pattern: rule.ua_pattern,
        rule_type: match rule.rule_type {
            db::entities::ua_rule::UaRuleType::Allow => "allow".to_string(),
            db::entities::ua_rule::UaRuleType::Deny => "deny".to_string(),
        },
        description: rule.description,
        is_active: rule.is_active,
        priority: rule.priority,
        created_at: rule.created_at.and_utc().to_rfc3339(),
        updated_at: rule.updated_at.and_utc().to_rfc3339(),
    }))
}

/// 删除 UA 规则
pub async fn delete_ua_rule(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<StatusCode, StatusCode> {
    let deleted = db::UaRuleRepo::delete(&state.db, id)
        .await
        .map_err(rule_db_err)?;
    
    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

/// 批量启用/禁用 UA 规则
pub async fn batch_ua_rules(
    State(state): State<Arc<AppState>>,
    Json(req): Json<BatchOperationRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let is_active = match req.action.as_str() {
        "enable" => true,
        "disable" => false,
        _ => return Err(StatusCode::BAD_REQUEST),
    };
    
    let affected = db::UaRuleRepo::batch_set_active(&state.db, req.ids, is_active)
        .await
        .map_err(rule_db_err)?;
    
    Ok(Json(serde_json::json!({
        "affected": affected
    })))
}
