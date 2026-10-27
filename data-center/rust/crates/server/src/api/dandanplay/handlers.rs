use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use std::sync::Arc;

use crate::{AppState, MatchQuery};
use super::models::*;

/// POST /api/v2/match - 弹幕匹配
pub async fn match_video(
    State(state): State<Arc<AppState>>,
    Json(req): Json<MatchRequest>,
) -> Result<Json<MatchResponse>, (StatusCode, String)> {
    // 生成缓存键：使用文件名和哈希
    let cache_key = if let Some(hash) = &req.file_hash {
        format!("dandanplay:match:hash:{}", hash)
    } else {
        format!("dandanplay:match:filename:{}", req.file_name)
    };
    
    // 尝试从缓存读取
    match state.cache.get(&cache_key).await {
        Ok(Some(cached)) => {
            tracing::info!("Cache hit for key: {}", cache_key);
            // 反序列化缓存的响应
            if let Ok(resp) = serde_json::from_str::<MatchResponse>(&cached.body) {
                return Ok(Json(resp));
            }
            // 缓存数据无效，继续执行匹配
            tracing::warn!("Invalid cached data, will re-match");
        }
        Ok(None) => {
            tracing::info!("Cache miss for key: {}", cache_key);
        }
        Err(e) => {
            tracing::error!("Cache read error: {}", e);
            // 缓存读取失败，继续执行匹配
        }
    }
    
    // 执行视频匹配
    let query = MatchQuery {
        file_name: req.file_name.clone(),
        file_hash: req.file_hash.clone(),
        file_size: req.file_size.map(|s| s as i64),
        video_duration: req.video_duration,
    };
    
    let matches = state.match_service
        .match_video(&query)
        .await
        .map_err(|e| {
            tracing::error!("Match video error: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, format!("匹配失败: {}", e))
        })?;
    
    // 转换为 API 响应格式
    let results: Vec<MatchResult> = matches.into_iter().map(|m| {
        MatchResult {
            episode_id: m.episode_id as i32,
            anime_title: m.anime_title,
            episode_title: m.episode_title.unwrap_or_default(),
            type_description: m.type_description.unwrap_or_default(),
            shift: m.confidence as f64,
        }
    }).collect();
    
    let resp = MatchResponse {
        success: true,
        error_message: None,
        matches: results,
    };
    
    // 写入缓存（24 小时）
    if let Ok(body) = serde_json::to_string(&resp) {
        if let Err(e) = state.cache.set(&cache_key, &body, 200, 86400).await {
            tracing::error!("Cache write error: {}", e);
            // 缓存写入失败不影响响应
        }
    }
    
    Ok(Json(resp))
}

/// GET /api/v2/comment/{episode_id} - 获取弹幕
pub async fn get_comments(
    State(state): State<Arc<AppState>>,
    Path(episode_id): Path<i32>,
) -> Result<Json<CommentResponse>, (StatusCode, String)> {
    tracing::info!("Get comments for episode_id: {}", episode_id);
    
    let episode_id_str = episode_id.to_string();
    
    // 尝试从本地文件存储读取弹幕
    match state.comment_store.get(&episode_id_str).await {
        Ok(Some(danmaku)) => {
            // 转换为 API 响应格式
            let comments: Vec<Comment> = danmaku.comments.into_iter().map(|c| Comment {
                id: c.id,
                position: c.position,
                message: c.message,
            }).collect();
            
            let resp = CommentResponse {
                count: comments.len() as i32,
                comments,
            };
            
            tracing::info!("Returned {} comments from local store", resp.count);
            Ok(Json(resp))
        }
        Ok(None) => {
            // 本地没有，尝试从 dandanplay API 获取
            tracing::info!("No comments in local store, fetching from dandanplay API");
            
            match state.dandanplay_client.get_comments(&episode_id_str).await {
                Ok(api_response) => {
                    // 将 API 响应存储到本地
                    let json_body = serde_json::to_string(&api_response)
                        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
                    
                    if let Err(e) = state.comment_store.archive(&episode_id_str, &json_body, "dandanplay").await {
                        tracing::warn!("Failed to archive comments: {}", e);
                        // 存储失败不影响返回
                    }
                    
                    // 转换为标准响应
                    let comments: Vec<Comment> = api_response.comments.into_iter().map(|c| Comment {
                        id: c.id,
                        position: c.position,
                        message: c.message,
                    }).collect();
                    
                    let resp = CommentResponse {
                        count: comments.len() as i32,
                        comments,
                    };
                    
                    tracing::info!("Fetched and archived {} comments from API", resp.count);
                    Ok(Json(resp))
                }
                Err(super::client::DandanplayError::NotFound) => {
                    // API 返回 404，说明该集数没有弹幕
                    tracing::info!("Episode {} not found on dandanplay API", episode_id);
                    Ok(Json(CommentResponse {
                        count: 0,
                        comments: vec![],
                    }))
                }
                Err(e) => {
                    // 网络或其他错误
                    tracing::error!("Failed to fetch comments from API: {}", e);
                    Err((StatusCode::BAD_GATEWAY, format!("无法从 dandanplay 获取弹幕: {}", e)))
                }
            }
        }
        Err(e) => {
            tracing::error!("Failed to read local comment store: {}", e);
            Err((StatusCode::INTERNAL_SERVER_ERROR, format!("读取本地弹幕失败: {}", e)))
        }
    }
}

/// POST /api/v2/extcomment - 获取第三方弹幕
pub async fn get_ext_comments(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ExtCommentRequest>,
) -> Result<Json<ExtCommentResponse>, (StatusCode, String)> {
    tracing::info!("Get external comments from: {}", req.url);
    
    // 1. 验证 URL
    if !is_valid_external_url(&req.url) {
        tracing::warn!("Invalid or forbidden external URL: {}", req.url);
        return Err((StatusCode::BAD_REQUEST, "无效的外部弹幕 URL".to_string()));
    }
    
    // 2. 下载弹幕 XML
    let xml_content = match state.dandanplay_client.http_client.get(&req.url).await {
        Ok(content) => content,
        Err(e) => {
            tracing::error!("Failed to fetch external comments: {}", e);
            return Err((StatusCode::BAD_GATEWAY, format!("无法获取外部弹幕: {}", e)));
        }
    };
    
    // 3. 解析 XML
    let parsed = match super::xml_parser::parse_xml_to_json(&xml_content) {
        Ok(p) => p,
        Err(e) => {
            tracing::error!("Failed to parse external XML: {}", e);
            return Err((StatusCode::INTERNAL_SERVER_ERROR, format!("解析外部弹幕失败: {}", e)));
        }
    };
    
    // 4. 转换为标准响应格式
    let comments: Vec<Comment> = parsed.comments.into_iter().map(|c| Comment {
        id: c.id,
        position: c.position,
        message: c.message,
    }).collect();
    
    let resp = ExtCommentResponse {
        count: comments.len() as i32,
        comments,
    };
    
    tracing::info!("Fetched {} external comments from {}", resp.count, req.url);
    Ok(Json(resp))
}

/// 验证外部 URL 是否合法
///
/// 白名单策略：只允许信任的弹幕源
fn is_valid_external_url(url: &str) -> bool {
    // 必须是 HTTP 或 HTTPS
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return false;
    }
    
    // 白名单域名
    const ALLOWED_DOMAINS: &[&str] = &[
        "api.dandanplay.net",
        "api.acplay.net",
        "comment.bilibili.com",
        "api.bilibili.com",
        // 可以根据需要添加更多信任的源
    ];
    
    // 提取域名
    let domain = extract_domain(url);
    
    // 检查是否在白名单中
    ALLOWED_DOMAINS.iter().any(|&allowed| {
        domain == allowed || domain.ends_with(&format!(".{}", allowed))
    })
}

/// 从 URL 中提取域名
fn extract_domain(url: &str) -> String {
    // 移除协议
    let without_protocol = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or(url);
    
    // 提取域名部分（到第一个 / 或 : 为止）
    without_protocol
        .split('/')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_valid_external_url() {
        // 有效的 URL
        assert!(is_valid_external_url("https://api.dandanplay.net/api/v2/comment/123"));
        assert!(is_valid_external_url("https://comment.bilibili.com/1.xml"));
        assert!(is_valid_external_url("http://api.acplay.net/comments.xml"));
        
        // 子域名应该被允许
        assert!(is_valid_external_url("https://cdn.api.dandanplay.net/data.xml"));
        
        // 无效的 URL
        assert!(!is_valid_external_url("https://evil.com/malicious.xml"));
        assert!(!is_valid_external_url("ftp://api.dandanplay.net/file.xml"));
        assert!(!is_valid_external_url("file:///etc/passwd"));
    }

    #[test]
    fn test_extract_domain() {
        assert_eq!(extract_domain("https://api.dandanplay.net/path"), "api.dandanplay.net");
        assert_eq!(extract_domain("http://example.com:8080/path"), "example.com");
        assert_eq!(extract_domain("https://sub.domain.com/path/to/file"), "sub.domain.com");
    }
}
