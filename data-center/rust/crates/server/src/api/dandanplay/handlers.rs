use axum::{
    body::Body,
    extract::{Path, RawQuery, State},
    http::{header, HeaderValue, StatusCode},
    response::Response,
    Json,
};
use std::sync::Arc;

use crate::AppState;
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

/// POST /api/v2/extcomment：兼容本地 XML 转换接口，不冒充官方未声明的接口。
pub async fn get_ext_comments(
    State(state): State<Arc<AppState>>,
    Json(req): Json<super::models::ExtCommentRequest>,
) -> Result<Response, (StatusCode, String)> {
    external_comments(&state, req).await
}

/// GET 兼容现有脚本的 ?url= 调用，与 POST 共用安全下载和字段缓存。
pub async fn get_ext_comments_query(
    State(state): State<Arc<AppState>>,
    axum::extract::Query(req): axum::extract::Query<super::models::ExtCommentRequest>,
) -> Result<Response, (StatusCode, String)> {
    external_comments(&state, req).await
}

async fn external_comments(state: &AppState, req: super::models::ExtCommentRequest)
    -> Result<Response, (StatusCode, String)> {
    let url = external_url(&req.url)?;
    let payload = serde_json::json!({"url": url.as_str()});
    let key = StructuredResponseStore::request_key("extcomment", None, Some(&payload));
    let store = StructuredResponseStore::new(state.db.clone());
    if let Some(value) = store.get("extcomment", &key).await
        .map_err(|_| (StatusCode::BAD_GATEWAY, "读取外部弹幕字段缓存失败".into()))? {
        return structured_response(value);
    }
    let xml = fetch_external_xml(url).await?;
    let value = external_xml_value(&xml)?;
    let assembled = store.ingest("extcomment", &key, &value).await
        .map_err(|_| (StatusCode::BAD_GATEWAY, "外部弹幕规范字段保存失败".into()))?
        .ok_or_else(|| (StatusCode::BAD_GATEWAY, "外部弹幕规范字段不完整".into()))?;
    structured_response(assembled)
}

fn external_xml_value(xml: &str) -> Result<Value, (StatusCode, String)> {
    // 旧手写解析器会把 HTML/JSON 或任意文本当作空弹幕成功，边界先校验 XML 根。
    let document = xml.trim_start_matches('\u{feff}').trim_start();
    if !(document.starts_with("<i>") || document.starts_with("<i ") || document.starts_with("<?xml"))
        || !document.trim_end().ends_with("</i>") {
        return Err((StatusCode::BAD_GATEWAY, "外部弹幕不是受支持的 XML".into()));
    }
    let parsed = super::xml_parser::parse_xml_to_json(&xml)
        .map_err(|_| (StatusCode::BAD_GATEWAY, "外部弹幕不是受支持的 XML".into()))?;
    // 响应只由解析后的规范字段组装，不回放任意上游正文。
    let comments: Vec<_> = parsed.comments.into_iter().map(|c| {
        let fields: Vec<_> = c.position.split(',').collect();
        // B 站 XML 为时间/模式/字号/颜色/时间戳/池/用户/行号；字号不是颜色。
        let position = if fields.len() >= 8 {
            format!("{},{},{},{}", fields[0], fields[1], fields[3], fields[6])
        } else { c.position };
        super::models::Comment { id: c.id, position, message: c.message }
    }).collect();
    Ok(serde_json::json!({"count": comments.len(), "comments": comments}))
}

fn external_url(value: &str) -> Result<reqwest::Url, (StatusCode, String)> {
    let invalid = || (StatusCode::BAD_REQUEST, "无效的外部弹幕 URL".into());
    let url = reqwest::Url::parse(value).map_err(|_| invalid())?;
    // 必须使用解析器的真实 host；禁止 userinfo、非标准端口与任意子域。
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty()
        || url.password().is_some() || url.port().is_some() || url.fragment().is_some()
        || !matches!(url.host_str(), Some("api.dandanplay.net" | "api.acplay.net"
            | "comment.bilibili.com" | "api.bilibili.com")) {
        return Err(invalid());
    }
    Ok(url)
}

fn public_address(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(ip) => {
            let [a,b,_,_] = ip.octets();
            // 同时拒绝共享、文档、基准测试、保留地址，不能只检查 RFC1918。
            !(ip.is_private() || ip.is_loopback() || ip.is_link_local() || ip.is_multicast()
                || a == 0 || a >= 240 || (a == 100 && (64..=127).contains(&b))
                || (a == 192 && b == 0) || (a == 198 && (b == 18 || b == 19 || b == 51))
                || (a == 203 && b == 0))
        }
        // IPv6 仅允许全球单播；拒绝映射 IPv4、ULA、回环和文档段。
        std::net::IpAddr::V6(ip) => {
            let s = ip.segments();
            s[0] & 0xe000 == 0x2000 && !(s[0] == 0x2001 && (s[1] == 0xdb8 || s[1] < 0x200))
        }
    }
}

async fn fetch_external_xml(url: reqwest::Url) -> Result<String, (StatusCode, String)> {
    let failure = || (StatusCode::BAD_GATEWAY, "无法获取外部弹幕".into());
    let host = url.host_str().ok_or_else(failure)?.to_owned();
    let port = url.port_or_known_default().ok_or_else(failure)?;
    let addresses: Vec<_> = tokio::time::timeout(std::time::Duration::from_secs(5),
        tokio::net::lookup_host((host.as_str(), port))).await.map_err(|_| failure())?
        .map_err(|_| failure())?.collect();
    if addresses.is_empty() || addresses.iter().any(|address| !public_address(address.ip())) {
        return Err((StatusCode::BAD_REQUEST, "外部弹幕域名解析到禁止的地址".into()));
    }
    // 固定本次已验证的 DNS 结果以防重绑定，禁代理和跳转，避免白名单绕过。
    let client = reqwest::Client::builder().no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .resolve_to_addrs(&host, &addresses).build().map_err(|_| failure())?;
    let mut response = client.get(url).send().await.map_err(|_| failure())?;
    if !response.status().is_success() { return Err(failure()); }
    const MAX_XML_BYTES: usize = 8 * 1024 * 1024;
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| failure())? {
        if chunk.len() > MAX_XML_BYTES.saturating_sub(body.len()) { return Err(failure()); }
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body).map_err(|_| failure())
}
