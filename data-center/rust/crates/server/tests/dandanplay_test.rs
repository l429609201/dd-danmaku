use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::json;
use tower::ServiceExt;
use std::sync::Arc;

use server::{create_router, AppState};

/// 测试辅助：创建测试用的 app
async fn test_app() -> axum::Router {
    let config = db::DbConfig::default();
    let db = db::init_db(&config).await.unwrap();
    db::test_helper::create_test_schema(&db).await.unwrap();
    
    let mut state = AppState::new_for_test(db);
    state.run_mode = server::RunMode::Api;
    create_router(state)
}

#[tokio::test]
async fn test_dandanplay_match() {
    let app = test_app().await;
    
    let req_body = json!({
        "fileName": "test_video.mp4",
        "fileHash": "abc123",
        "fileSize": 1024000,
        "videoDuration": 1440.5
    });
    
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v2/match")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&req_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    
    assert_eq!(response.status(), StatusCode::OK);
    
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let resp: serde_json::Value = serde_json::from_slice(&body).unwrap();
    
    assert_eq!(resp["success"], true);
    assert!(resp["matches"].is_array());
}

#[tokio::test]
async fn test_dandanplay_get_comments() {
    let config = db::DbConfig::default();
    let db = db::init_db(&config).await.unwrap();
    db::test_helper::create_test_schema(&db).await.unwrap();
    
    let mut state = AppState::new_for_test(db.clone());
    state.run_mode = server::RunMode::Api;
    
    // 预先写入一些测试弹幕到本地存储
    let test_body = r#"{"count": 2, "comments": [{"cid": 1, "p": "10.5,1,25,16777215,1234567890", "m": "测试弹幕1"}, {"cid": 2, "p": "20.0,1,25,16777215,1234567891", "m": "测试弹幕2"}]}"#;
    state.comment_store.archive("12345", test_body, "test").await.unwrap();
    
    let app = create_router(state);
    
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v2/comment/12345")
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
    
    // 应该返回预写入的 2 条弹幕
    assert_eq!(resp["count"].as_i64().unwrap(), 2);
    assert!(resp["comments"].is_array());
    assert_eq!(resp["comments"].as_array().unwrap().len(), 2);
}

#[tokio::test]
#[ignore] // 需要网络连接和真实的外部 URL
async fn test_dandanplay_ext_comments() {
    let app = test_app().await;
    
    // 使用白名单中的域名（但这会触发真实网络请求）
    let req_body = json!({
        "url": "https://api.dandanplay.net/api/v2/comment/123456"
    });
    
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v2/extcomment")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_string(&req_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    
    // 可能返回 200 或 502（网络问题）
    let status = response.status();
    assert!(status == StatusCode::OK || status == StatusCode::BAD_GATEWAY);
}
