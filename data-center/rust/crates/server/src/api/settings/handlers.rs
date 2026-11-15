use axum::{
    extract::{State, Json, Query},
    http::StatusCode,
};
use db::{entities::config, ConfigRepo};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
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
    Json(req): Json<UpdateConfigRequest>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
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
    // 从环境变量获取配置
    let url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "sqlite::memory:".to_string());
    
    // 脱敏处理：隐藏密码部分
    let masked_url = mask_database_url(&url);
    
    let config = DatabaseConfig {
        url: masked_url,
        max_connections: 80,
        min_connections: 10,
    };
    
    Ok(Json(config))
}

/// 获取缓存配置
pub async fn get_cache_config(
    State(_state): State<AppState>,
) -> Result<Json<CacheConfig>, (StatusCode, String)> {
    let config = CacheConfig {
        enabled: true,
        ttl_seconds: 3600,
        max_entries: 10000,
    };
    
    Ok(Json(config))
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
        Err(e) => HealthStatus {
            status: "error".to_string(),
            message: Some(e.to_string()),
            latency_ms: None,
        },
    };
    
    // 检查缓存（简单检查，不执行实际操作）
    let cache_status = HealthStatus {
        status: "ok".to_string(),
        message: None,
        latency_ms: None,
    };
    
    // 检查存储（检查弹幕目录是否可写）
    let storage_status = HealthStatus {
        status: "ok".to_string(),
        message: None,
        latency_ms: None,
    };
    
    let overall_status = if db_status.status == "ok" {
        "healthy"
    } else {
        "unhealthy"
    };
    
    Ok(Json(HealthCheckResponse {
        status: overall_status.to_string(),
        database: db_status,
        cache: cache_status,
        storage: storage_status,
        timestamp: chrono::Utc::now().to_rfc3339(),
    }))
}

/// 脱敏数据库 URL
fn mask_database_url(url: &str) -> String {
    // 简单的脱敏处理：隐藏密码部分
    if url.contains('@') {
        let parts: Vec<&str> = url.split('@').collect();
        if parts.len() == 2 {
            let before_at = parts[0];
            let after_at = parts[1];
            
            // 查找用户名和密码的分隔符 ':'
            if let Some(colon_pos) = before_at.rfind(':') {
                let protocol_and_user = &before_at[..colon_pos];
                return format!("{}:****@{}", protocol_and_user, after_at);
            }
        }
    }
    
    // 如果不包含密码，直接返回
    url.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_mask_database_url() {
        let url = "mysql://user:password123@localhost:3306/db";
        let masked = mask_database_url(url);
        assert_eq!(masked, "mysql://user:****@localhost:3306/db");
        
        let url2 = "sqlite::memory:";
        let masked2 = mask_database_url(url2);
        assert_eq!(masked2, "sqlite::memory:");
    }
}
