use axum::{
    body::Body,
    extract::{Path, RawQuery, State},
    http::{header, HeaderValue, StatusCode},
    response::Response,
    Json,
};
use std::sync::Arc;

use crate::AppState;
use super::models::*;
use serde_json::Value;
use crate::structured_response_store::StructuredResponseStore;

/// POST /api/v2/match：没有文件映射证据时忠实回源，不能把内部主键或置信度当上游字段。
pub async fn match_video(
    State(state): State<Arc<AppState>>,
    RawQuery(query): RawQuery,
    Json(payload): Json<Value>,
) -> Result<Response, (StatusCode, String)> {
    if !payload.is_object() {
        return Err((StatusCode::BAD_REQUEST, "匹配请求必须为 JSON 对象".into()));
    }
    // 保留原始 JSON 的全部字段及类型：包括 fileName/fileHash/fileSize/videoDuration/matchMode。
    // 当前 schema 没有文件哈希映射表，不能凭文件名解析伪造匹配，亦不能忽略 matchMode。
    upstream_response(&state, "match", query, Some(payload)).await
}

/// GET /api/v2/comment/{episode_id}：全部查询参数原样转发，不能混用不同转换/关联弹幕选项。
pub async fn get_comments(
    State(state): State<Arc<AppState>>,
    Path(episode_id): Path<String>,
    RawQuery(query): RawQuery,
) -> Result<Response, (StatusCode, String)> {
    // 上游 ID 不经过 i32 截断；同时禁止路径注入。
    if episode_id.is_empty() || episode_id.len() > 32
        || !episode_id.bytes().all(|b| b.is_ascii_digit()) {
        return Err((StatusCode::BAD_REQUEST, "剧集 ID 必须为数字".into()));
    }
    upstream_response(&state, &format!("comment/{episode_id}"), query, None).await
}

/// 成功响应仅从规范化表重建；失败响应保留上游状态和正文。
async fn upstream_response(
    state: &AppState,
    path: &str,
    query: Option<String>,
    payload: Option<Value>,
) -> Result<Response, (StatusCode, String)> {
    let client = crate::dandanplay_upstream::client()
        .map_err(|_| (StatusCode::BAD_GATEWAY, "无法创建弹弹上游连接".into()))?;
    upstream_response_with_client(state, path, query, payload, &client, "https://api.dandanplay.net").await
}

/// 私有传输接缝：生产调用固定官方地址；独立测试可注入本地 mock，不提供配置或路由入口。
async fn upstream_response_with_client(
    state: &AppState,
    path: &str,
    query: Option<String>,
    payload: Option<Value>,
    client: &reqwest::Client,
    origin: &str,
) -> Result<Response, (StatusCode, String)> {
    let api_path = format!("/api/v2/{path}");
    let mut url = reqwest::Url::parse(&format!("{origin}{api_path}"))
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "无法构建弹弹请求".into()))?;
    // RawQuery 保留重复参数、空值及未知参数，不使用会丢失重复项的 Map。
    url.set_query(query.as_deref());
    let key = StructuredResponseStore::request_key(path, query.as_deref(), payload.as_ref());
    let store = StructuredResponseStore::new(state.db.clone());
    match store.get(path, &key).await {
        Ok(Some(value)) => return structured_response(value),
        Err(error) => tracing::warn!("读取结构化协议响应失败，继续回源: {error}"),
        Ok(None) => {}
    }

    let request = if let Some(ref body) = payload {
        client.post(url).json(body)
    } else {
        client.get(url)
    };
    // 只在真实回源时读取签名凭据；命中结构化表不要求在线凭据。私有回环测试不连接官方域名。
    let request = if origin == "https://api.dandanplay.net" {
        crate::dandanplay_upstream::authorize(&state.db, request, &api_path).await
            .map_err(|message| (StatusCode::SERVICE_UNAVAILABLE, message))?
    } else { request };
    let response = request.send().await.map_err(|e| {
            tracing::warn!("弹弹接口回源失败: {api_path}: {e}");
            (StatusCode::BAD_GATEWAY, "无法连接弹弹上游接口".into())
        })?;
    let status = response.status();
    let content_type = response.headers().get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok()).unwrap_or("application/octet-stream").to_string();
    let body = response.bytes().await.map_err(|e| {
        tracing::warn!("弹弹接口响应读取失败: {api_path}: {e}");
        (StatusCode::BAD_GATEWAY, "无法读取弹弹上游响应".into())
    })?;
    // 成功对象必须解析入表后重建；不能因新字段或数据库异常退回原始响应缓存。
    // 上游业务失败和 HTTP 失败仍原样交还，便于客户端诊断。
    if status == StatusCode::OK {
        if let Ok(value) = serde_json::from_slice::<Value>(&body) {
            match store.ingest(path, &key, &value).await {
                Ok(Some(reconstructed)) => return structured_response(reconstructed),
                Ok(None) => {},
                Err(error) => {
                    tracing::warn!("规范化弹弹响应失败: {api_path}: {error}");
                    return Err((StatusCode::BAD_GATEWAY, "上游成功响应无法按支持的协议字段入库".into()));
                }
            }
        } else {
            return Err((StatusCode::BAD_GATEWAY, "上游成功响应不是有效 JSON".into()));
        }
    }
    Ok(raw_response(status, &content_type, body.to_vec()))
}

fn structured_response(value: Value) -> Result<Response, (StatusCode, String)> {
    let body = serde_json::to_vec(&value)
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "无法编码结构化响应".into()))?;
    Ok(raw_response(StatusCode::OK, "application/json", body))
}

fn raw_response(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response {
    let mut response = Response::new(Body::from(body));
    *response.status_mut() = status;
    if let Ok(value) = HeaderValue::from_str(content_type) {
        response.headers_mut().insert(header::CONTENT_TYPE, value);
    }
    response
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
