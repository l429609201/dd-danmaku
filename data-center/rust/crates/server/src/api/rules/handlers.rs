use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::AppState;
use super::models::*;

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
    let offset = (page - 1) * page_size;
    
    let (rules, total) = db::IpRuleRepo::find_all(&state.db, offset, page_size)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
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
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
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
    // 验证 rule_type
    let rule_type = match req.rule_type.as_str() {
        "allow" => db::entities::ip_rule::IpRuleType::Allow,
        "deny" => db::entities::ip_rule::IpRuleType::Deny,
        _ => return Err(StatusCode::BAD_REQUEST),
    };
    
    let priority = req.priority.unwrap_or(100);
    
    let rule = db::IpRuleRepo::create(
        &state.db,
        req.ip_pattern,
        rule_type,
        req.description,
        priority,
    )
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
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
        req.ip_pattern,
        rule_type,
        req.description,
        req.is_active,
        req.priority,
    )
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
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
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
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
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
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
    let offset = (page - 1) * page_size;
    
    let (rules, total) = db::UaRuleRepo::find_all(&state.db, offset, page_size)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
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
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
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
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
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
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
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
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
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
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    Ok(Json(serde_json::json!({
        "affected": affected
    })))
}
