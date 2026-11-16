use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
};
use std::sync::Arc;
use crate::AppState;
use super::models::*;

// ==================== 阶段 5: 密钥池管理 ====================

/// 获取 API 密钥列表
pub async fn get_api_keys(
    State(state): State<Arc<AppState>>,
    Query(params): Query<super::models::WorkerLogQuery>,
) -> Result<Json<ApiKeyListResponse>, StatusCode> {
    // 与管理接口统一边界：非法分页直接拒绝，不静默修正客户端输入。
    if params.page == 0 || !(1..=100).contains(&params.page_size) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let page = params.page;
    let page_size = params.page_size;
    // 分页值来自客户端，先检查乘法和数据库有符号偏移边界。
    let offset = (page - 1).checked_mul(page_size)
        .filter(|offset| *offset <= i64::MAX as u64)
        .ok_or(StatusCode::BAD_REQUEST)?;
    
    let (keys, total) = db::ApiKeyPoolRepo::find_all(&state.db, offset, page_size)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    let key_infos = keys.into_iter().map(|k| ApiKeyInfo {
        id: k.id,
        name: k.name,
        api_key: mask_secret(&k.api_key),
        source: k.source,
        is_active: k.is_active,
        priority: k.priority,
        last_used_at: k.last_used_at.map(|t| t.and_utc().to_rfc3339()),
        use_count: k.use_count,
        created_at: k.created_at.and_utc().to_rfc3339(),
        updated_at: k.updated_at.and_utc().to_rfc3339(),
    }).collect();
    
    Ok(Json(ApiKeyListResponse { keys: key_infos, total, page, page_size }))
}

pub async fn create_api_key(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateApiKeyRequest>,
) -> Result<Json<ApiKeyInfo>, StatusCode> {
    validate_required(&[&req.name, &req.api_key, &req.source])?;
    let priority = req.priority.unwrap_or(100);
    let key = db::ApiKeyPoolRepo::create(&state.db, req.name, req.api_key, req.source, priority)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    Ok(Json(ApiKeyInfo {
        id: key.id,
        name: key.name,
        api_key: mask_secret(&key.api_key),
        source: key.source,
        is_active: key.is_active,
        priority: key.priority,
        last_used_at: key.last_used_at.map(|t| t.and_utc().to_rfc3339()),
        use_count: key.use_count,
        created_at: key.created_at.and_utc().to_rfc3339(),
        updated_at: key.updated_at.and_utc().to_rfc3339(),
    }))
}

pub async fn update_api_key(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(req): Json<UpdateApiKeyRequest>,
) -> Result<Json<ApiKeyInfo>, StatusCode> {
    // 局部更新允许省略字段，但不允许把必填值改成空白。
    for value in [&req.name, &req.api_key, &req.source].into_iter().flatten() {
        validate_required(&[value])?;
    }
    let key = db::ApiKeyPoolRepo::update(&state.db, id, req.name, req.api_key, req.source, req.is_active, req.priority)
        .await
        .map_err(map_database_error)?;
    
    Ok(Json(ApiKeyInfo {
        id: key.id,
        name: key.name,
        api_key: mask_secret(&key.api_key),
        source: key.source,
        is_active: key.is_active,
        priority: key.priority,
        last_used_at: key.last_used_at.map(|t| t.and_utc().to_rfc3339()),
        use_count: key.use_count,
        created_at: key.created_at.and_utc().to_rfc3339(),
        updated_at: key.updated_at.and_utc().to_rfc3339(),
    }))
}

pub async fn delete_api_key(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<StatusCode, StatusCode> {
    let deleted = db::ApiKeyPoolRepo::delete(&state.db, id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

// 签名密钥 CRUD（简化实现）
pub async fn get_sign_keys(
    State(state): State<Arc<AppState>>,
    Query(params): Query<super::models::WorkerLogQuery>,
) -> Result<Json<SignKeyListResponse>, StatusCode> {
    // 与管理接口统一边界：非法分页直接拒绝，不静默修正客户端输入。
    if params.page == 0 || !(1..=100).contains(&params.page_size) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let page = params.page;
    let page_size = params.page_size;
    // 分页值来自客户端，先检查乘法和数据库有符号偏移边界。
    let offset = (page - 1).checked_mul(page_size)
        .filter(|offset| *offset <= i64::MAX as u64)
        .ok_or(StatusCode::BAD_REQUEST)?;
    
    let (keys, total) = db::SignKeyPoolRepo::find_all(&state.db, offset, page_size)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    let key_infos = keys.into_iter().map(|k| SignKeyInfo {
        id: k.id,
        name: k.name,
        sign_key: mask_secret(&k.sign_key),
        purpose: k.purpose,
        is_active: k.is_active,
        last_used_at: k.last_used_at.map(|t| t.and_utc().to_rfc3339()),
        created_at: k.created_at.and_utc().to_rfc3339(),
        updated_at: k.updated_at.and_utc().to_rfc3339(),
    }).collect();
    
    Ok(Json(SignKeyListResponse { keys: key_infos, total, page, page_size }))
}

pub async fn create_sign_key(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateSignKeyRequest>,
) -> Result<Json<SignKeyInfo>, StatusCode> {
    validate_required(&[&req.name, &req.sign_key, &req.purpose])?;
    let key = db::SignKeyPoolRepo::create(&state.db, req.name, req.sign_key, req.purpose)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    Ok(Json(SignKeyInfo {
        id: key.id,
        name: key.name,
        sign_key: mask_secret(&key.sign_key),
        purpose: key.purpose,
        is_active: key.is_active,
        last_used_at: key.last_used_at.map(|t| t.and_utc().to_rfc3339()),
        created_at: key.created_at.and_utc().to_rfc3339(),
        updated_at: key.updated_at.and_utc().to_rfc3339(),
    }))
}

/// 更新现有记录，不存在时返回 404；敏感字段沿用脱敏响应。
pub async fn update_sign_key(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(req): Json<UpdateSignKeyRequest>,
) -> Result<Json<SignKeyInfo>, StatusCode> {
    // 局部更新保持省略字段不变，拒绝清空必填字段。
    for value in [&req.name, &req.sign_key, &req.purpose].into_iter().flatten() {
        validate_required(&[value])?;
    }
    let key = db::SignKeyPoolRepo::update(&state.db, id, req.name, req.sign_key, req.purpose, req.is_active)
        .await
        .map_err(map_database_error)?;

    Ok(Json(SignKeyInfo {
        id: key.id,
        name: key.name,
        sign_key: mask_secret(&key.sign_key),
        purpose: key.purpose,
        is_active: key.is_active,
        last_used_at: key.last_used_at.map(|t| t.and_utc().to_rfc3339()),
        created_at: key.created_at.and_utc().to_rfc3339(),
        updated_at: key.updated_at.and_utc().to_rfc3339(),
    }))
}


pub async fn delete_sign_key(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<StatusCode, StatusCode> {
    let deleted = db::SignKeyPoolRepo::delete(&state.db, id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    if deleted { Ok(StatusCode::NO_CONTENT) } else { Err(StatusCode::NOT_FOUND) }
}

// 用户白名单 CRUD（简化实现）
pub async fn get_user_allows(
    State(state): State<Arc<AppState>>,
    Query(params): Query<super::models::WorkerLogQuery>,
) -> Result<Json<UserAllowListResponse>, StatusCode> {
    // 与管理接口统一边界：非法分页直接拒绝，不静默修正客户端输入。
    if params.page == 0 || !(1..=100).contains(&params.page_size) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let page = params.page;
    let page_size = params.page_size;
    // 分页值来自客户端，先检查乘法和数据库有符号偏移边界。
    let offset = (page - 1).checked_mul(page_size)
        .filter(|offset| *offset <= i64::MAX as u64)
        .ok_or(StatusCode::BAD_REQUEST)?;
    
    let (users, total) = db::UserAllowPoolRepo::find_all(&state.db, offset, page_size)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    let user_infos = users.into_iter().map(|u| UserAllowInfo {
        id: u.id,
        user_identifier: u.user_identifier,
        user_type: u.user_type,
        description: u.description,
        is_active: u.is_active,
        created_at: u.created_at.and_utc().to_rfc3339(),
        updated_at: u.updated_at.and_utc().to_rfc3339(),
    }).collect();
    
    Ok(Json(UserAllowListResponse { users: user_infos, total, page, page_size }))
}

pub async fn create_user_allow(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateUserAllowRequest>,
) -> Result<Json<UserAllowInfo>, StatusCode> {
    validate_required(&[&req.user_identifier, &req.user_type])?;
    let user = db::UserAllowPoolRepo::create(&state.db, req.user_identifier, req.user_type, req.description)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    Ok(Json(UserAllowInfo {
        id: user.id,
        user_identifier: user.user_identifier,
        user_type: user.user_type,
        description: user.description,
        is_active: user.is_active,
        created_at: user.created_at.and_utc().to_rfc3339(),
        updated_at: user.updated_at.and_utc().to_rfc3339(),
    }))
}

/// 更新现有记录，不存在时返回 404；敏感字段沿用脱敏响应。
pub async fn update_user_allow(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(req): Json<UpdateUserAllowRequest>,
) -> Result<Json<UserAllowInfo>, StatusCode> {
    // 局部更新保持省略字段不变，拒绝清空必填字段。
    for value in [&req.user_type].into_iter().flatten() {
        validate_required(&[value])?;
    }
    let user = db::UserAllowPoolRepo::update(&state.db, id, req.user_type, req.description, req.is_active)
        .await
        .map_err(map_database_error)?;

    Ok(Json(UserAllowInfo {
        id: user.id,
        user_identifier: user.user_identifier,
        user_type: user.user_type,
        description: user.description,
        is_active: user.is_active,
        created_at: user.created_at.and_utc().to_rfc3339(),
        updated_at: user.updated_at.and_utc().to_rfc3339(),
    }))
}


pub async fn delete_user_allow(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<StatusCode, StatusCode> {
    let deleted = db::UserAllowPoolRepo::delete(&state.db, id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    if deleted { Ok(StatusCode::NO_CONTENT) } else { Err(StatusCode::NOT_FOUND) }
}

// OAuth 配置 CRUD（简化实现）
pub async fn get_oauth_configs(
    State(state): State<Arc<AppState>>,
) -> Result<Json<OAuthConfigListResponse>, StatusCode> {
    let configs = db::OAuthConfigRepo::find_all(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    let config_infos = configs.into_iter().map(|c| OAuthConfigInfo {
        id: c.id,
        provider: c.provider,
        client_id: c.client_id,
        client_secret: mask_secret(&c.client_secret),
        redirect_uri: c.redirect_uri,
        scope: c.scope,
        is_active: c.is_active,
        created_at: c.created_at.and_utc().to_rfc3339(),
        updated_at: c.updated_at.and_utc().to_rfc3339(),
    }).collect();
    
    Ok(Json(OAuthConfigListResponse { configs: config_infos }))
}

pub async fn create_oauth_config(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateOAuthConfigRequest>,
) -> Result<Json<OAuthConfigInfo>, StatusCode> {
    validate_required(&[&req.provider, &req.client_id, &req.client_secret, &req.redirect_uri])?;
    let config = db::OAuthConfigRepo::create(&state.db, req.provider, req.client_id, req.client_secret, req.redirect_uri, req.scope)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    Ok(Json(OAuthConfigInfo {
        id: config.id,
        provider: config.provider,
        client_id: config.client_id,
        client_secret: mask_secret(&config.client_secret),
        redirect_uri: config.redirect_uri,
        scope: config.scope,
        is_active: config.is_active,
        created_at: config.created_at.and_utc().to_rfc3339(),
        updated_at: config.updated_at.and_utc().to_rfc3339(),
    }))
}

/// 更新现有记录，不存在时返回 404；敏感字段沿用脱敏响应。
pub async fn update_oauth_config(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(req): Json<UpdateOAuthConfigRequest>,
) -> Result<Json<OAuthConfigInfo>, StatusCode> {
    // 局部更新保持省略字段不变，拒绝清空必填字段。
    for value in [&req.client_id, &req.client_secret, &req.redirect_uri].into_iter().flatten() {
        validate_required(&[value])?;
    }
    let config = db::OAuthConfigRepo::update(&state.db, id, req.client_id, req.client_secret, req.redirect_uri, req.scope, req.is_active)
        .await
        .map_err(map_database_error)?;

    Ok(Json(OAuthConfigInfo {
        id: config.id,
        provider: config.provider,
        client_id: config.client_id,
        client_secret: mask_secret(&config.client_secret),
        redirect_uri: config.redirect_uri,
        scope: config.scope,
        is_active: config.is_active,
        created_at: config.created_at.and_utc().to_rfc3339(),
        updated_at: config.updated_at.and_utc().to_rfc3339(),
    }))
}


pub async fn delete_oauth_config(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<StatusCode, StatusCode> {
    let deleted = db::OAuthConfigRepo::delete(&state.db, id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    if deleted { Ok(StatusCode::NO_CONTENT) } else { Err(StatusCode::NOT_FOUND) }
}

// ==================== 阶段 6: 日志和监控 ====================

pub async fn get_worker_logs(
    State(state): State<Arc<AppState>>,
    Query(params): Query<WorkerLogQuery>,
) -> Result<Json<WorkerLogListResponse>, StatusCode> {
    // 与管理接口统一边界：非法分页直接拒绝，不静默修正客户端输入。
    if params.page == 0 || !(1..=100).contains(&params.page_size) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let page = params.page;
    let page_size = params.page_size;
    // 分页值来自客户端，先检查乘法和数据库有符号偏移边界。
    let offset = (page - 1).checked_mul(page_size)
        .filter(|offset| *offset <= i64::MAX as u64)
        .ok_or(StatusCode::BAD_REQUEST)?;
    
    let (logs, total) = db::WorkerLogRepo::find_all(&state.db, offset, page_size, params.level, params.node_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    let log_infos = logs.into_iter().map(|l| WorkerLogInfo {
        id: l.id,
        node_id: l.node_id,
        level: l.level,
        message: l.message,
        extra_data: l.extra_data,
        created_at: l.created_at.and_utc().to_rfc3339(),
    }).collect();
    
    Ok(Json(WorkerLogListResponse { logs: log_infos, total, page, page_size }))
}

pub async fn get_ip_stats(
    State(state): State<Arc<AppState>>,
    Query(params): Query<IpStatsQuery>,
) -> Result<Json<IpStatsListResponse>, StatusCode> {
    // 与管理接口统一边界：非法分页直接拒绝，不静默修正客户端输入。
    if params.page == 0 || !(1..=100).contains(&params.page_size) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let page = params.page;
    let page_size = params.page_size;
    // 分页值来自客户端，先检查乘法和数据库有符号偏移边界。
    let offset = (page - 1).checked_mul(page_size)
        .filter(|offset| *offset <= i64::MAX as u64)
        .ok_or(StatusCode::BAD_REQUEST)?;
    
    let (stats, total) = db::IpStatsRepo::find_all(&state.db, offset, page_size, params.ip)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    let stat_infos = stats.into_iter().map(|s| IpStatInfo {
        id: s.id,
        ip_address: s.ip_address,
        path: s.path,
        method: s.method,
        status_code: s.status_code,
        user_agent: s.user_agent,
        request_time: s.request_time.and_utc().to_rfc3339(),
        response_time_ms: s.response_time_ms,
    }).collect();
    
    Ok(Json(IpStatsListResponse { stats: stat_infos, total, page, page_size }))
}

pub async fn get_top_ips(
    State(state): State<Arc<AppState>>,
) -> Result<Json<IpStatsAggregateResponse>, StatusCode> {
    let top_ips = db::IpStatsRepo::get_top_ips(&state.db, 10)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    let aggregates = top_ips.into_iter().map(|(ip, count)| IpStatAggregate {
        ip_address: ip,
        request_count: count,
    }).collect();
    
    Ok(Json(IpStatsAggregateResponse { top_ips: aggregates }))
}

// ==================== 阶段 7: 数据清理 ====================

pub async fn get_cleanup_policies(
    State(state): State<Arc<AppState>>,
) -> Result<Json<CleanupPolicyListResponse>, StatusCode> {
    let policies = db::CleanupPolicyRepo::find_all(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    let policy_infos = policies.into_iter().map(|p| CleanupPolicyInfo {
        id: p.id,
        name: p.name,
        target_table: p.target_table,
        condition: p.condition,
        retention_days: p.retention_days,
        is_active: p.is_active,
        schedule: p.schedule,
        last_run_at: p.last_run_at.map(|t| t.and_utc().to_rfc3339()),
        last_cleanup_count: p.last_cleanup_count,
        created_at: p.created_at.and_utc().to_rfc3339(),
        updated_at: p.updated_at.and_utc().to_rfc3339(),
    }).collect();
    
    Ok(Json(CleanupPolicyListResponse { policies: policy_infos }))
}

pub async fn create_cleanup_policy(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateCleanupPolicyRequest>,
) -> Result<Json<CleanupPolicyInfo>, StatusCode> {
    validate_required(&[&req.name, &req.schedule])?;
    validate_cleanup_policy(&req.target_table, &req.condition, req.retention_days)?;
    let policy = db::CleanupPolicyRepo::create(&state.db, req.name, req.target_table, req.condition, req.retention_days, req.schedule)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    Ok(Json(CleanupPolicyInfo {
        id: policy.id,
        name: policy.name,
        target_table: policy.target_table,
        condition: policy.condition,
        retention_days: policy.retention_days,
        is_active: policy.is_active,
        schedule: policy.schedule,
        last_run_at: policy.last_run_at.map(|t| t.and_utc().to_rfc3339()),
        last_cleanup_count: policy.last_cleanup_count,
        created_at: policy.created_at.and_utc().to_rfc3339(),
        updated_at: policy.updated_at.and_utc().to_rfc3339(),
    }))
}

/// 更新现有记录，不存在时返回 404；敏感字段沿用脱敏响应。
pub async fn update_cleanup_policy(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(req): Json<UpdateCleanupPolicyRequest>,
) -> Result<Json<CleanupPolicyInfo>, StatusCode> {
    // 局部更新保持省略字段不变，拒绝清空必填字段。
    for value in [&req.name, &req.schedule].into_iter().flatten() {
        validate_required(&[value])?;
    }
    // 合并现有策略后校验，避免仅更新部分字段绕过清理安全边界。
    let current = db::CleanupPolicyRepo::find_by_id(&state.db, id)
        .await
        .map_err(map_database_error)?
        .ok_or(StatusCode::NOT_FOUND)?;
    validate_cleanup_policy(
        &current.target_table,
        req.condition.as_deref().unwrap_or(&current.condition),
        req.retention_days.unwrap_or(current.retention_days),
    )?;
    let policy = db::CleanupPolicyRepo::update(&state.db, id, req.name, req.condition, req.retention_days, req.is_active, req.schedule)
        .await
        .map_err(map_database_error)?;

    Ok(Json(CleanupPolicyInfo {
        id: policy.id,
        name: policy.name,
        target_table: policy.target_table,
        condition: policy.condition,
        retention_days: policy.retention_days,
        is_active: policy.is_active,
        schedule: policy.schedule,
        last_run_at: policy.last_run_at.map(|t| t.and_utc().to_rfc3339()),
        last_cleanup_count: policy.last_cleanup_count,
        created_at: policy.created_at.and_utc().to_rfc3339(),
        updated_at: policy.updated_at.and_utc().to_rfc3339(),
    }))
}


pub async fn delete_cleanup_policy(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> Result<StatusCode, StatusCode> {
    let deleted = db::CleanupPolicyRepo::delete(&state.db, id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    if deleted { Ok(StatusCode::NO_CONTENT) } else { Err(StatusCode::NOT_FOUND) }
}

pub async fn execute_cleanup(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ExecuteCleanupRequest>,
) -> Result<Json<CleanupExecutionResponse>, StatusCode> {
    let policy = db::CleanupPolicyRepo::find_by_id(&state.db, req.policy_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    
    // 执行清理逻辑（简化实现，实际需要根据策略执行 SQL）
    let deleted_count = execute_cleanup_logic(&state.db, &policy).await?;
    
    db::CleanupPolicyRepo::update_last_run(&state.db, req.policy_id, deleted_count as i64)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    Ok(Json(CleanupExecutionResponse {
        policy_id: req.policy_id,
        deleted_count,
        executed_at: chrono::Utc::now().to_rfc3339(),
    }))
}

// 辅助函数
fn map_database_error(error: sea_orm::DbErr) -> StatusCode {
    // 资源不存在是客户端可处理的 404，不能与数据库故障混为 500。
    match error {
        sea_orm::DbErr::RecordNotFound(_) => StatusCode::NOT_FOUND,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

fn validate_required(values: &[&str]) -> Result<(), StatusCode> {
    // 避免成功持久化不可用的空白标识、密钥或配置。
    if values.iter().any(|value| value.trim().is_empty()) {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(())
}

fn validate_cleanup_policy(target: &str, condition: &str, days: i32) -> Result<(), StatusCode> {
    // 执行器只实现按保留天数清理；拒绝忽略自定义条件，防止误删超出预期范围。
    if !matches!(target, "worker_logs" | "ip_stats")
        || !condition.trim().is_empty()
        || !(1..=36_500).contains(&days)
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(())
}

fn mask_secret(secret: &str) -> String {
    // 按字符而非 UTF-8 字节切片，避免非 ASCII 合成密钥导致请求任务崩溃。
    let length = secret.chars().count();
    if length <= 8 {
        "****".to_string()
    } else {
        let prefix: String = secret.chars().take(4).collect();
        let suffix: String = secret.chars().skip(length - 4).collect();
        format!("{prefix}****{suffix}")
    }
}

async fn execute_cleanup_logic(
    _db: &sea_orm::DatabaseConnection,
    policy: &db::entities::cleanup_policy::Model,
) -> Result<u64, StatusCode> {
    // 既有数据库记录同样需要校验，负数保留期不能扩大删除范围。
    validate_cleanup_policy(&policy.target_table, &policy.condition, policy.retention_days)?;
    match policy.target_table.as_str() {
        "worker_logs" => {
            let days_ago = chrono::Utc::now().naive_utc() - chrono::Duration::days(policy.retention_days as i64);
            db::WorkerLogRepo::delete_old(_db, days_ago)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
        },
        "ip_stats" => {
            let days_ago = chrono::Utc::now().naive_utc() - chrono::Duration::days(policy.retention_days as i64);
            db::IpStatsRepo::delete_old(_db, days_ago)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
        },
        _ => Err(StatusCode::BAD_REQUEST),
    }
}
