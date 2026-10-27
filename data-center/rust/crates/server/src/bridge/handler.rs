use axum::{
    extract::{
        ws::{Message, WebSocket},
        State, WebSocketUpgrade,
    },
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use crate::AppState;
use super::protocol::BridgeMessage;
use super::connection::ConnectionManager;

/// WebSocket 连接处理器
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

/// 处理单个 WebSocket 连接
async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    let (mut ws_sender, mut ws_receiver) = socket.split();
    
    // 创建消息通道
    let (tx, mut rx) = mpsc::unbounded_channel::<BridgeMessage>();
    
    // 等待注册消息
    let (worker_id, node_id, worker_url) = match wait_for_register(&mut ws_receiver, &mut ws_sender).await {
        Ok(result) => result,
        Err(e) => {
            warn!("Registration failed: {}", e);
            return;
        }
    };
    
    // 注册到连接管理器
    let connection_id = match state.bridge_manager.register(
        node_id.clone(),
        worker_id.clone(),
        worker_url.clone(),
        "v1".to_string(),
        None,
        tx.clone(),
    ).await {
        Ok(id) => id,
        Err(e) => {
            error!("Failed to register connection: {}", e);
            return;
        }
    };
    
    info!("WebSocket connection established: {} (node: {})", connection_id, node_id);
    
    // 发送注册确认
    let ack = BridgeMessage::RegisterAck {
        success: true,
        message: None,
        connection_id: Some(connection_id.clone()),
    };
    
    if let Err(e) = send_message(&mut ws_sender, &ack).await {
        error!("Failed to send register ack: {}", e);
        state.bridge_manager.disconnect(&connection_id).await;
        return;
    }
    
    // 启动消息收发循环
    let manager = Arc::clone(&state.bridge_manager);
    let state_clone = Arc::clone(&state);
    let conn_id = connection_id.clone();
    
    let recv_task = tokio::spawn(async move {
        while let Some(result) = ws_receiver.next().await {
            match result {
                Ok(msg) => {
                    if let Err(e) = handle_incoming_message(msg, &conn_id, &manager, &state_clone).await {
                        error!("Error handling message: {}", e);
                        break;
                    }
                }
                Err(e) => {
                    error!("WebSocket error: {}", e);
                    break;
                }
            }
        }
    });
    
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if let Err(e) = send_message(&mut ws_sender, &msg).await {
                error!("Failed to send message: {}", e);
                break;
            }
        }
    });
    
    // 等待任一任务完成
    tokio::select! {
        _ = recv_task => {
            debug!("Receive task completed");
        }
        _ = send_task => {
            debug!("Send task completed");
        }
    }
    
    // 清理
    state.bridge_manager.disconnect(&connection_id).await;
    info!("WebSocket connection closed: {}", connection_id);
}

/// 等待注册消息
async fn wait_for_register(
    ws_receiver: &mut futures_util::stream::SplitStream<WebSocket>,
    _ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
) -> Result<(String, String, String), String> {
    // 超时 10 秒
    match tokio::time::timeout(
        tokio::time::Duration::from_secs(10),
        ws_receiver.next(),
    )
    .await
    {
        Ok(Some(Ok(Message::Text(text)))) => {
            let msg: BridgeMessage = serde_json::from_str(&text)
                .map_err(|e| format!("Invalid register message: {}", e))?;
            
            match msg {
                BridgeMessage::Register {
                    node_id,
                    worker_id,
                    worker_url,
                    ..
                } => Ok((worker_id, node_id, worker_url)),
                _ => Err("Expected register message".to_string()),
            }
        }
        Ok(Some(Ok(_))) => Err("Expected text message".to_string()),
        Ok(Some(Err(e))) => Err(format!("WebSocket error: {}", e)),
        Ok(None) => Err("Connection closed".to_string()),
        Err(_) => Err("Registration timeout".to_string()),
    }
}

/// 处理接收到的消息
async fn handle_incoming_message(
    msg: Message,
    connection_id: &str,
    manager: &ConnectionManager,
    state: &AppState,
) -> Result<(), String> {
    match msg {
        Message::Text(text) => {
            let bridge_msg: BridgeMessage = serde_json::from_str(&text)
                .map_err(|e| format!("Invalid message: {}", e))?;
            
            debug!("Received message: {:?}", bridge_msg);
            
            match bridge_msg {
                BridgeMessage::Pong { timestamp } => {
                    manager.update_heartbeat(connection_id, timestamp).await?;
                }
                BridgeMessage::CacheGet { message_id, cache_key } => {
                    // 处理缓存查询请求
                    handle_cache_get(connection_id, message_id, cache_key, manager, state).await?;
                }
                BridgeMessage::CacheGetResult { .. } => {
                    // Worker 响应的缓存结果，暂时记录日志
                    info!("Received cache result from worker: {:?}", bridge_msg);
                }
                _ => {
                    // 其他消息类型的处理逻辑
                    debug!("Unhandled message type: {:?}", bridge_msg);
                }
            }
            
            Ok(())
        }
        Message::Close(_) => Err("Connection closed by peer".to_string()),
        _ => Ok(()), // Ignore other message types
    }
}

/// 处理缓存查询请求
async fn handle_cache_get(
    connection_id: &str,
    message_id: String,
    cache_key: String,
    manager: &ConnectionManager,
    state: &AppState,
) -> Result<(), String> {
    info!("Handling CacheGet: message_id={}, cache_key={}", message_id, cache_key);
    
    // 查询本地缓存
    let cached = match state.cache.get(&cache_key).await {
        Ok(cached) => cached,
        Err(e) => {
            error!("Cache query failed: {}", e);
            let err_msg = BridgeMessage::Error {
                message_id: Some(message_id),
                error_code: "CACHE_QUERY_ERROR".to_string(),
                error_message: format!("Failed to query cache: {}", e),
            };
            return manager.send_to_connection(connection_id, err_msg).await
                .map_err(|e| format!("Failed to send error: {}", e));
        }
    };
    
    // 如果缓存命中，直接返回
    if let Some(cached) = cached {
        let value = serde_json::json!({
            "body": cached.body,
            "status_code": cached.status_code,
            "storage_mode": cached.storage_mode,
        });
        
        let result = BridgeMessage::CacheGetResult {
            message_id,
            cache_key,
            found: true,
            value: Some(value),
        };
        
        return manager.send_to_connection(connection_id, result).await
            .map_err(|e| format!("Failed to send cache result: {}", e));
    }
    
    // 缓存未命中，尝试自动获取
    info!("Cache miss for key: {}, attempting auto-fetch", cache_key);
    
    let fetch_result = try_auto_fetch(&cache_key, state).await;
    
    match fetch_result {
        Ok(Some(body)) => {
            // 自动获取成功，写入缓存并返回
            info!("Auto-fetch successful for key: {}", cache_key);
            
            // 写入缓存（24小时 TTL）
            if let Err(e) = state.cache.set(
                &cache_key,
                &body,
                200,
                86400, // 24 hours in seconds
            ).await {
                warn!("Failed to cache auto-fetched data: {}", e);
            }
            
            let value = serde_json::json!({
                "body": body,
                "status_code": 200,
                "storage_mode": "disk",
            });
            
            let result = BridgeMessage::CacheGetResult {
                message_id,
                cache_key,
                found: true,
                value: Some(value),
            };
            
            manager.send_to_connection(connection_id, result).await
                .map_err(|e| format!("Failed to send result: {}", e))
        }
        Ok(None) => {
            // 不支持的 cache_key 类型或获取失败，返回未找到
            info!("Auto-fetch returned no data for key: {}", cache_key);
            
            let result = BridgeMessage::CacheGetResult {
                message_id,
                cache_key,
                found: false,
                value: None,
            };
            
            manager.send_to_connection(connection_id, result).await
                .map_err(|e| format!("Failed to send miss: {}", e))
        }
        Err(e) => {
            // 自动获取出错
            error!("Auto-fetch failed for key {}: {}", cache_key, e);
            
            let err_msg = BridgeMessage::Error {
                message_id: Some(message_id),
                error_code: "AUTO_FETCH_ERROR".to_string(),
                error_message: format!("Failed to fetch data: {}", e),
            };
            
            manager.send_to_connection(connection_id, err_msg).await
                .map_err(|e| format!("Failed to send error: {}", e))
        }
    }
}

/// 尝试自动获取数据
/// 
/// 支持的 cache_key 格式：
/// - `dandanplay:comment:{episode_id}` - 弹幕数据
/// 
/// 返回 Ok(Some(body)) 表示获取成功
/// 返回 Ok(None) 表示不支持该类型或数据不存在
/// 返回 Err 表示获取过程出错
async fn try_auto_fetch(
    cache_key: &str,
    state: &AppState,
) -> Result<Option<String>, String> {
    // 解析 cache_key
    if let Some(episode_id) = cache_key.strip_prefix("dandanplay:comment:") {
        // 弹幕数据，调用 comment_store
        match state.comment_store.get(episode_id).await {
            Ok(Some(response)) => {
                // 本地有弹幕文件
                let json = serde_json::to_string(&response)
                    .map_err(|e| format!("Failed to serialize comment response: {}", e))?;
                Ok(Some(json))
            }
            Ok(None) => {
                // 本地没有，尝试从 dandanplay API 获取
                info!("Fetching comments from dandanplay API for episode: {}", episode_id);
                
                match state.dandanplay_client.get_comments(episode_id).await {
                    Ok(response) => {
                        // 获取成功，写入本地存储
                        let json_body = serde_json::to_string(&response)
                            .map_err(|e| format!("Failed to serialize API response: {}", e))?;
                        
                        if let Err(e) = state.comment_store.archive(
                            episode_id,
                            &json_body,
                            "dandanplay",
                        ).await {
                            warn!("Failed to archive comments: {}", e);
                        }
                        
                        Ok(Some(json_body))
                    }
                    Err(e) => {
                        warn!("Failed to fetch comments from API: {}", e);
                        Ok(None) // 返回 None 而不是 Err，让 Worker 知道数据不存在
                    }
                }
            }
            Err(e) => {
                Err(format!("Failed to query comment store: {}", e))
            }
        }
    } else {
        // 不支持的 cache_key 类型
        debug!("Unsupported cache_key format for auto-fetch: {}", cache_key);
        Ok(None)
    }
}

/// 发送消息
async fn send_message(
    ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    msg: &BridgeMessage,
) -> Result<(), String> {
    let text = serde_json::to_string(msg)
        .map_err(|e| format!("Failed to serialize message: {}", e))?;
    
    ws_sender
        .send(Message::Text(text.into()))
        .await
        .map_err(|e| format!("Failed to send message: {}", e))
}
