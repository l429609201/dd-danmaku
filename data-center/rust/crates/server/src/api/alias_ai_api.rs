use axum::{
    extract::{State, Query},
    Json,
    http::StatusCode,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::{AppState, ScoringResult, ScoringStatus};

/// 开始 AI 打分请求
#[derive(Debug, Deserialize)]
pub struct StartScoringRequest {
    pub max_calls: Option<u32>,
}

/// 开始 AI 打分任务
pub async fn start_ai_scoring(
    State(state): State<Arc<AppState>>,
    Query(params): Query<StartScoringRequest>,
) -> (StatusCode, Json<ScoringResult>) {
    let result = state.alias_ai.start_scoring(
        state.db.clone(),
        params.max_calls,
    ).await;
    
    // 参数非法返回 400；尚未实现的工作流明确返回 501，不能以 HTTP 200 冒充已启动。
    let status = if params.max_calls.is_some_and(|limit| limit == 0 || limit > 1000) {
        StatusCode::BAD_REQUEST
    } else {
        StatusCode::NOT_IMPLEMENTED
    };
    (status, Json(result))
}

/// 获取 AI 打分状态
pub async fn get_ai_scoring_status(
    State(state): State<Arc<AppState>>,
) -> Json<ScoringStatus> {
    let status = state.alias_ai.get_status().await;
    Json(status)
}
