use tokio_tungstenite::{connect_async, tungstenite::Message};
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use std::sync::Arc;

/// WebSocket 客户端测试：验证 Worker Bridge 完整流程
#[tokio::test]
async fn test_worker_bridge_flow() {
    // 启动测试服务器
    let config = db::DbConfig::default();
    let db = db::init_db(&config).await.unwrap();
    db::test_helper::create_test_schema(&db).await.unwrap();
    
    let state = server::AppState::new_for_test(db);
    let app = server::create_router(state);
    
    // 在后台启动服务器
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    
    // 等待服务器启动
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    
    // 连接 WebSocket
    let ws_url = format!("ws://{}/api/ws/worker", addr);
    let (ws_stream, _) = connect_async(&ws_url).await
        .expect("Failed to connect to WebSocket");
    
    let (mut write, mut read) = ws_stream.split();
    
    // 1. 发送 Register 消息
    let register_msg = json!({
        "type": "register",
        "node_id": "test-node-001",
        "worker_id": "test-worker-001",
        "worker_url": "http://localhost:8000",
        "protocol_version": "v1",
        "client_version": "test-0.1.0"
    });
    
    write.send(Message::Text(register_msg.to_string()))
        .await
        .expect("Failed to send register message");
    
    // 2. 接收 RegisterAck
    let response = read.next().await.unwrap().unwrap();
    if let Message::Text(text) = response {
        let ack: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(ack["type"], "register_ack");
        assert_eq!(ack["success"], true);
        assert!(ack["connection_id"].is_string());
    } else {
        panic!("Expected text message");
    }
    
    // 3. 发送 CacheGet 请求
    let cache_get_msg = json!({
        "type": "cache_get",
        "message_id": "msg-001",
        "cache_key": "test-cache-key"
    });
    
    write.send(Message::Text(cache_get_msg.to_string()))
        .await
        .expect("Failed to send cache_get message");
    
    // 4. 接收 CacheGetResult（缓存未命中）
    let response = read.next().await.unwrap().unwrap();
    if let Message::Text(text) = response {
        let result: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(result["type"], "cache_get_result");
        assert_eq!(result["message_id"], "msg-001");
        assert_eq!(result["cache_key"], "test-cache-key");
        assert_eq!(result["found"], false);
        assert!(result["value"].is_null());
    } else {
        panic!("Expected text message");
    }
    
    // 5. 发送 Ping
    let ping_msg = json!({
        "type": "ping",
        "timestamp": chrono::Utc::now().timestamp_millis()
    });
    
    write.send(Message::Text(ping_msg.to_string()))
        .await
        .expect("Failed to send ping message");
    
    // Pong 由服务器自动响应（心跳机制），这里不需要验证
    
    // 6. 关闭连接
    write.close().await.expect("Failed to close connection");
}

/// 测试缓存命中场景
#[tokio::test]
async fn test_cache_hit_flow() {
    use server::CacheService;
    
    // 初始化测试数据库
    let config = db::DbConfig::default();
    let db = db::init_db(&config).await.unwrap();
    db::test_helper::create_test_schema(&db).await.unwrap();
    
    // 预先插入缓存数据
    let cache_service = CacheService::new(db.clone());
    let test_key = "test-hit-key";
    let test_body = json!({"result": "cached data"}).to_string();
    
    cache_service.set(
        test_key,
        &test_body,
        200,
        3600, // 1 hour TTL
    ).await.expect("Failed to set cache");
    
    let state = server::AppState::new_for_test(db.clone());
    // 替换 cache 为预填充的实例
    let state = server::AppState {
        cache: std::sync::Arc::new(cache_service),
        ..state
    };
    let app = server::create_router(state);
    
    // 启动服务器
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    
    // 连接 WebSocket
    let ws_url = format!("ws://{}/api/ws/worker", addr);
    let (ws_stream, _) = connect_async(&ws_url).await
        .expect("Failed to connect to WebSocket");
    
    let (mut write, mut read) = ws_stream.split();
    
    // 注册
    let register_msg = json!({
        "type": "register",
        "node_id": "test-node-002",
        "worker_id": "test-worker-002",
        "worker_url": "http://localhost:8001",
        "protocol_version": "v1"
    });
    
    write.send(Message::Text(register_msg.to_string())).await.unwrap();
    let _ = read.next().await.unwrap().unwrap(); // 跳过 RegisterAck
    
    // 查询缓存
    let cache_get_msg = json!({
        "type": "cache_get",
        "message_id": "msg-hit-001",
        "cache_key": test_key
    });
    
    write.send(Message::Text(cache_get_msg.to_string())).await.unwrap();
    
    // 验证缓存命中
    let response = read.next().await.unwrap().unwrap();
    if let Message::Text(text) = response {
        let result: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(result["type"], "cache_get_result");
        assert_eq!(result["message_id"], "msg-hit-001");
        assert_eq!(result["cache_key"], test_key);
        assert_eq!(result["found"], true);
        assert!(result["value"].is_object());
        
        let cached_body = result["value"]["body"].as_str().unwrap();
        assert_eq!(cached_body, test_body);
    } else {
        panic!("Expected text message");
    }
    
    write.close().await.unwrap();
}
