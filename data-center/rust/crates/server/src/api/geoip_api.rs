use axum::{
    extract::State,
    http::StatusCode,
    Json,
};
use std::sync::Arc;

use crate::{AppState, GeoDistributionResponse};

/// 获取 IP 地理分布（用于地图展示）
pub async fn get_geo_distribution(
    State(state): State<Arc<AppState>>,
) -> Result<Json<GeoDistributionResponse>, StatusCode> {
    // 对外只返回状态码，不暴露数据库错误、连接信息或 SQL。
    let response = state.geoip.get_geo_distribution(&state.db).await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(response))
}
