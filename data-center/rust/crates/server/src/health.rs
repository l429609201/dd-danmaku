use axum::{extract::State, Json};
use sea_orm::ConnectionTrait;
use std::sync::Arc;

use crate::{AppState, HealthResponse};

/// 健康检查端点
pub async fn health_check(
    State(state): State<Arc<AppState>>,
) -> Json<HealthResponse> {
    // 检查数据库连接
    let db_status = match state.db.ping().await {
        Ok(_) => {
            let backend = state.db.get_database_backend();
            format!("{:?} - connected", backend)
        }
        Err(e) => format!("disconnected: {}", e),
    };

    Json(HealthResponse {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        database: db_status,
    })
}
