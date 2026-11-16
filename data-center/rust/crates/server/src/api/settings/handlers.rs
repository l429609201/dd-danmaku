use axum::{
    extract::{State, Json, Query},
    http::StatusCode,
};
use db::{entities::config, ConfigRepo};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, ConnectionTrait, DbBackend, PaginatorTrait};
use crate::AppState;
use super::models::*;

/// 获取系统配置
pub async fn get_config(
    State(state): State<AppState>,
    Query(query): Query<GetConfigQuery>,
) -> Result<Json<ConfigListResponse>, (StatusCode, String)> {
    let configs = if let Some(namespace) = query.namespace {
        // 按 namespace 查询
        config::Entity::find()
            .filter(config::Column::Namespace.eq(namespace))
            .all(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    } else {
        // 查询所有
        config::Entity::find()
            .all(&state.db)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    };
    
    let config_items: Vec<ConfigItem> = configs.into_iter().map(|c| {
        // 即使历史行缺少 is_secret 标志，也不回显专用密钥字段。
        let sensitive = c.is_secret || (c.namespace == crate::upstream_config::NAMESPACE && c.config_key == "app_secret");
        ConfigItem {
        namespace: c.namespace,
        key: c.config_key,
        value: if sensitive { "****".to_string() } else { c.value_text.unwrap_or_default() },
        description: c.description,
        updated_at: c.updated_at.and_utc().to_rfc3339(),
        is_secret: sensitive,
    }}).collect();
    
    let total = config_items.len();
    
    Ok(Json(ConfigListResponse {
        configs: config_items,
        total,
    }))
}

/// 更新系统配置
pub async fn update_config(
    State(state): State<AppState>,
    payload: Result<Json<UpdateConfigRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    // 拒绝无效 JSON，统一返回前端可读取的错误信封。
    let Json(req) = payload.map_err(|_| config_error(StatusCode::BAD_REQUEST, "请求 JSON 无效：需要 configs 数组".into()))?;
    // 写入任何项之前检查整个批次，防止绕过专用原子校验。
    if req.configs.iter().any(|item| item.namespace == crate::upstream_config::NAMESPACE) {
        return Err((StatusCode::BAD_REQUEST, Json(serde_json::json!({"message":"dandanplay 命名空间仅允许通过专用配置接口更新"}))));
    }
    for item in req.configs {
        ConfigRepo::set(
            &state.db,
            &item.namespace,
            &item.key,
            &item.value,
            None,
        )
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"message":"无法保存系统配置"}))))?;
    }
    
    Ok(StatusCode::NO_CONTENT)
}

type DandanplayConfigError = (StatusCode, Json<serde_json::Value>);
fn config_error(status: StatusCode, message: String) -> DandanplayConfigError {
    (status, Json(serde_json::json!({"message": message})))
}

/// 只返回脱敏投影；缺少主密钥仍可读取状态，界面据此提示部署配置。
pub async fn get_dandanplay_config(State(state): State<AppState>) -> Result<Json<DandanplayConfigResponse>, DandanplayConfigError> {
    crate::upstream_config::get_config(&state.db).await.map(Json)
        .map_err(|message| config_error(StatusCode::INTERNAL_SERVER_ERROR, message))
}

/// JSON 拒绝也使用 message 信封，避免客户端丢失可读错误。
pub async fn put_dandanplay_config(
    State(state): State<AppState>,
    payload: Result<Json<UpdateDandanplayConfigRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<DandanplayConfigResponse>, DandanplayConfigError> {
    let Json(request) = payload.map_err(|_| config_error(StatusCode::BAD_REQUEST, "请求 JSON 无效：需要 app_id、user_agent 和可选 app_secret".into()))?;
    crate::upstream_config::ConfigCipher::from_env()
        .map_err(|message| config_error(StatusCode::SERVICE_UNAVAILABLE, message))?;
    crate::upstream_config::save_config(&state.db, request).await
        .map_err(|message| config_error(StatusCode::BAD_REQUEST, message))?;
    get_dandanplay_config(State(state)).await
}

/// 获取数据库配置
pub async fn get_database_config(
    State(state): State<AppState>,
) -> Result<Json<DatabaseConfig>, (StatusCode, String)> {
    // 实际连接驱动是唯一事实来源；不回显环境 URL，避免兼容变量误报和凭据泄漏。
    let backend = match state.db.get_database_backend() {
        DbBackend::MySql => "mysql",
        DbBackend::Postgres => "postgres",
        DbBackend::Sqlite => "sqlite",
    };
    Ok(Json(DatabaseConfig {
        url: format!("{backend}://[连接地址已隐藏]"),
        // AppState 未保留建池参数，不能把默认值当作实测配置。
        max_connections: None,
        min_connections: None,
    }))
}

/// 获取缓存配置
pub async fn get_cache_config(
    State(state): State<AppState>,
) -> Result<Json<CacheConfig>, (StatusCode, String)> {
    // SQL 冷缓存始终存在；TTL 由各条目和请求策略决定，不伪造统一容量/TTL。
    Ok(Json(CacheConfig {
        enabled: true,
        ttl_seconds: None,
        max_entries: None,
        redis_enabled: state.redis.is_enabled(),
    }))
}

/// 健康检查
pub async fn health_check(
    State(state): State<AppState>,
) -> Result<Json<HealthCheckResponse>, (StatusCode, String)> {
    let start = std::time::Instant::now();
    
    // 检查数据库
    let db_status = match state.db.ping().await {
        Ok(_) => HealthStatus {
            status: "ok".to_string(),
            message: None,
            latency_ms: Some(start.elapsed().as_millis() as u64),
        },
        Err(_) => HealthStatus {
            status: "error".to_string(),
            message: Some("数据库连接检查失败".into()),
            latency_ms: None,
        },
    };
    
    // 用只读查表验证 SQL 缓存可访问；Redis 尚无只读探针，不声称热层健康。
    let cache_status = match db::entities::api_response_cache::Entity::find().count(&state.db).await {
        Ok(_) => HealthStatus { status: "ok".into(), message: Some("SQL 缓存可访问；Redis 热层未探测".into()), latency_ms: None },
        Err(_) => HealthStatus { status: "error".into(), message: Some("SQL 缓存查询失败".into()), latency_ms: None },
    };
    // 状态对象未暴露实际存储目录，且 GET 健康检查不应写测试文件。
    let storage_status = HealthStatus {
        status: "unknown".into(),
        message: Some("未验证弹幕存储目录读写能力".into()),
        latency_ms: None,
    };
    let overall_status = if db_status.status == "error" || cache_status.status == "error" {
        "unhealthy"
    } else {
        "degraded"
    };

    Ok(Json(HealthCheckResponse {
        status: overall_status.to_string(),
        database: db_status,
        cache: cache_status,
        storage: storage_status,
        timestamp: chrono::Utc::now().to_rfc3339(),
    }))
}
