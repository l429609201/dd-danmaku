use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::AppState;
use db::{ControlNodeRepo, ControlMessageRepo, MessageQuery, RuntimeEventRepo, EventQuery};

/// 通用分页参数
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
    50
}

/// 通用分页响应
#[derive(Debug, Serialize)]
pub struct PaginatedResponse<T> {
    pub items: Vec<T>,
    pub total: u64,
    pub page: u64,
    pub page_size: u64,
    pub total_pages: u64,
}

impl<T> PaginatedResponse<T> {
    pub fn new(items: Vec<T>, total: u64, page: u64, page_size: u64) -> Self {
        let total_pages = (total + page_size - 1) / page_size;
        Self {
            items,
            total,
            page,
            page_size,
            total_pages,
        }
    }
}

/// 通用错误响应
#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
    pub message: String,
}

impl ErrorResponse {
    pub fn new(error: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            message: message.into(),
        }
    }
}

/// API 错误类型
pub type ApiResult<T> = Result<Json<T>, (StatusCode, Json<ErrorResponse>)>;

/// 将 DbErr 转换为 API 错误
pub fn db_error_to_response(err: sea_orm::DbErr) -> (StatusCode, Json<ErrorResponse>) {
    tracing::error!("Database error: {:?}", err);
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse::new("database_error", err.to_string())),
    )
}

// ============================================================
// Control Nodes API
// ============================================================

/// 节点列表查询参数
#[derive(Debug, Deserialize)]
pub struct NodeListQuery {
    pub connected: Option<bool>,
}

/// 列出所有控制节点
pub async fn list_nodes(
    State(state): State<Arc<AppState>>,
    Query(query): Query<NodeListQuery>,
) -> ApiResult<Vec<db::entities::control_node::Model>> {
    let nodes = if let Some(true) = query.connected {
        ControlNodeRepo::list_connected(&state.db)
            .await
            .map_err(db_error_to_response)?
    } else {
        ControlNodeRepo::list_all(&state.db)
            .await
            .map_err(db_error_to_response)?
    };

    Ok(Json(nodes))
}

/// 获取单个节点
pub async fn get_node(
    State(state): State<Arc<AppState>>,
    Path(node_id): Path<String>,
) -> ApiResult<db::entities::control_node::Model> {
    let node = ControlNodeRepo::find_by_node_id(&state.db, &node_id)
        .await
        .map_err(db_error_to_response)?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new("not_found", format!("Node {} not found", node_id))),
            )
        })?;

    Ok(Json(node))
}

/// 节点创建/更新请求
#[derive(Debug, Deserialize)]
pub struct UpsertNodeRequest {
    pub node_id: String,
    pub worker_id: String,
    pub worker_url: String,
    pub connected: bool,
}

/// 创建或更新节点
pub async fn upsert_node(
    State(state): State<Arc<AppState>>,
    Json(req): Json<UpsertNodeRequest>,
) -> ApiResult<db::entities::control_node::Model> {
    let node = ControlNodeRepo::upsert(
        &state.db,
        req.node_id,
        req.worker_id,
        req.worker_url,
        req.connected,
    )
    .await
    .map_err(db_error_to_response)?;

    Ok(Json(node))
}

// ============================================================
// Control Messages API
// ============================================================

/// 消息查询参数
#[derive(Debug, Deserialize)]
pub struct MessageListQuery {
    #[serde(flatten)]
    pub pagination: PaginationQuery,
    pub node_id: Option<String>,
    pub direction: Option<String>,
    pub message_type: Option<String>,
    pub status: Option<String>,
}

/// 列出控制消息（分页）
pub async fn list_messages(
    State(state): State<Arc<AppState>>,
    Query(query): Query<MessageListQuery>,
) -> ApiResult<PaginatedResponse<db::entities::control_message::Model>> {
    let msg_query = MessageQuery {
        page: query.pagination.page,
        page_size: query.pagination.page_size,
        node_id: query.node_id,
        direction: query.direction,
        message_type: query.message_type,
        status: query.status,
    };

    let (items, total) = ControlMessageRepo::find_paginated(&state.db, &msg_query)
        .await
        .map_err(db_error_to_response)?;

    Ok(Json(PaginatedResponse::new(
        items,
        total,
        msg_query.page,
        msg_query.page_size,
    )))
}

/// 获取单个消息
pub async fn get_message(
    State(state): State<Arc<AppState>>,
    Path(message_id): Path<String>,
) -> ApiResult<db::entities::control_message::Model> {
    let message = ControlMessageRepo::find_by_message_id(&state.db, &message_id)
        .await
        .map_err(db_error_to_response)?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new(
                    "not_found",
                    format!("Message {} not found", message_id),
                )),
            )
        })?;

    Ok(Json(message))
}

// ============================================================
// Runtime Events API
// ============================================================

/// 事件查询参数
#[derive(Debug, Deserialize)]
pub struct EventListQuery {
    #[serde(flatten)]
    pub pagination: PaginationQuery,
    pub level: Option<String>,
    pub category: Option<String>,
    pub event: Option<String>,
}

/// 列出运行时事件（分页）
pub async fn list_events(
    State(state): State<Arc<AppState>>,
    Query(query): Query<EventListQuery>,
) -> ApiResult<PaginatedResponse<db::entities::runtime_event::Model>> {
    let event_query = EventQuery {
        page: query.pagination.page,
        page_size: query.pagination.page_size,
        level: query.level,
        category: query.category,
        event: query.event,
    };

    let (items, total) = RuntimeEventRepo::find_paginated(&state.db, &event_query)
        .await
        .map_err(db_error_to_response)?;

    Ok(Json(PaginatedResponse::new(
        items,
        total,
        event_query.page,
        event_query.page_size,
    )))
}

/// 获取最近的错误
pub async fn recent_errors(
    State(state): State<Arc<AppState>>,
    Query(query): Query<PaginationQuery>,
) -> ApiResult<Vec<db::entities::runtime_event::Model>> {
    let errors = RuntimeEventRepo::recent_errors(&state.db, query.page_size)
        .await
        .map_err(db_error_to_response)?;

    Ok(Json(errors))
}
