use axum::{
    extract::State,
    Json,
};
use std::sync::Arc;

use crate::{AppState, GeoDistributionResponse};

/// 获取 IP 地理分布（用于地图展示）
pub async fn get_geo_distribution(
    State(state): State<Arc<AppState>>,
) -> Json<GeoDistributionResponse> {
    let response = state.geoip.get_geo_distribution(&state.db).await;
    Json(response)
}
