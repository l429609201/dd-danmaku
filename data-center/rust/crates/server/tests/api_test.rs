use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::json;
use tower::ServiceExt;
use std::sync::Arc;

use server::{create_router, AppState, CacheService};

/// 测试辅助：创建测试用的 app
async fn test_app() -> axum::Router {
    let config = db::DbConfig::default();
    let db = db::init_db(&config).await.unwrap();
    
    // 创建表结构
    db::test_helper::create_test_schema(&db).await.unwrap();
    
    let state = AppState::new_for_test(db);
    create_router(state)
}

#[tokio::test]
async fn test_health_endpoint() {
    let app = test_app().await;
    
    let response = app
        .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
        .await
        .unwrap();
    
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_list_nodes_empty() {
    let app = test_app().await;
    
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/admin/control/nodes")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    
    assert_eq!(response.status(), StatusCode::OK);
    
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let nodes: Vec<db::entities::control_node::Model> =
        serde_json::from_slice(&body).unwrap();
    
    assert_eq!(nodes.len(), 0);
}

#[tokio::test]
async fn test_upsert_and_get_node() {
    let app = test_app().await;
    
    // 创建节点
    let create_req = json!({
        "node_id": "test-node-1",
        "worker_id": "worker-1",
        "worker_url": "https://worker1.example.com",
        "connected": true
    });
    
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/admin/control/nodes")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&create_req).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    
    assert_eq!(response.status(), StatusCode::OK);
    
    // 查询节点
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/admin/control/nodes/test-node-1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    
    assert_eq!(response.status(), StatusCode::OK);
    
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let node: db::entities::control_node::Model = serde_json::from_slice(&body).unwrap();
    
    assert_eq!(node.node_id, "test-node-1");
    assert_eq!(node.connected, true);
}

#[tokio::test]
async fn test_get_nonexistent_node() {
    let app = test_app().await;
    
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/admin/control/nodes/nonexistent")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_list_messages_empty() {
    let app = test_app().await;
    
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/admin/control/messages")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    
    assert_eq!(response.status(), StatusCode::OK);
    
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let resp: serde_json::Value = serde_json::from_slice(&body).unwrap();
    
    assert_eq!(resp["total"], 0);
    assert_eq!(resp["items"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn test_list_events_empty() {
    let app = test_app().await;
    
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/admin/runtime/events")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    
    assert_eq!(response.status(), StatusCode::OK);
    
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let resp: serde_json::Value = serde_json::from_slice(&body).unwrap();
    
    assert_eq!(resp["total"], 0);
}
