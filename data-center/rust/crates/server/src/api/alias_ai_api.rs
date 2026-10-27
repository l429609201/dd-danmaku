use axum::{
    extract::{State, Query},
    Json,
};
use serde::{Deserialize, Serialize};
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
) -> Json<ScoringResult> {
    let result = state.alias_ai.start_scoring(
        state.db.clone(),
        params.max_calls,
    ).await;
    
    Json(result)
}

/// 获取 AI 打分状态
pub async fn get_ai_scoring_status(
    State(state): State<Arc<AppState>>,
) -> Json<ScoringStatus> {
    let status = state.alias_ai.get_status().await;
    Json(status)
}
