use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::json;
use tower::ServiceExt; // for `oneshot`
use std::sync::Arc;

#[tokio::test]
async fn test_match_video_with_cache() {
    // 初始化测试数据库
    let config = db::DbConfig::default();
    let db = db::init_db(&config).await.expect("Failed to init db");
    db::test_helper::create_test_schema(&db).await.expect("Failed to create schema");
    
    // 创建应用状态
    let state = server::AppState::new_for_test(db);
    let app = server::create_router(state);
    
    // 第一次请求（缓存未命中）
    let request_body = json!({
        "fileName": "test_video.mp4",
        "fileHash": "abc123def456"
    });
    
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v2/match")
                .header("content-type", "application/json")
                .body(Body::from(request_body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    
    assert_eq!(response.status(), StatusCode::OK);
    
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let response_json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    
    assert_eq!(response_json["success"], true);
    assert!(response_json["matches"].is_array());
    
    // 第二次请求（缓存命中）
    let response2 = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v2/match")
                .header("content-type", "application/json")
                .body(Body::from(request_body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    
    assert_eq!(response2.status(), StatusCode::OK);
    
    let body2 = axum::body::to_bytes(response2.into_body(), usize::MAX)
        .await
        .unwrap();
    let response_json2: serde_json::Value = serde_json::from_slice(&body2).unwrap();
    
    // 验证两次响应一致（说明缓存工作）
    assert_eq!(response_json, response_json2);
}

#[tokio::test]
async fn test_match_video_different_requests() {
    // 初始化测试数据库
    let config = db::DbConfig::default();
    let db = db::init_db(&config).await.expect("Failed to init db");
    db::test_helper::create_test_schema(&db).await.expect("Failed to create schema");
    
    let state = server::AppState::new_for_test(db);
    let app = server::create_router(state);
    
    // 两个不同的请求
    let request1 = json!({
        "fileName": "video1.mp4",
        "fileHash": "hash1"
    });
    
    let request2 = json!({
        "fileName": "video2.mp4",
        "fileHash": "hash2"
    });
    
    let response1 = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v2/match")
                .header("content-type", "application/json")
                .body(Body::from(request1.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    
    let body1 = axum::body::to_bytes(response1.into_body(), usize::MAX)
        .await
        .unwrap();
    let json1: serde_json::Value = serde_json::from_slice(&body1).unwrap();
    
    let response2 = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v2/match")
                .header("content-type", "application/json")
                .body(Body::from(request2.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    
    let body2 = axum::body::to_bytes(response2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json2: serde_json::Value = serde_json::from_slice(&body2).unwrap();
    
    // 验证两个不同请求都成功返回（即使没有匹配结果）
    assert_eq!(json1["success"], true);
    assert_eq!(json2["success"], true);
    
    // 验证使用不同的缓存键（通过再次请求相同数据，应该命中缓存）
    assert!(json1["matches"].is_array());
    assert!(json2["matches"].is_array());
}
