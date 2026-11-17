//! 目录接口解析上游后写结构化实体，并从字段重建响应；数字集号复用整季。
use std::sync::Arc;
use axum::{extract::{Path, RawQuery, State}, http::{header, StatusCode}, response::{IntoResponse, Response}};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use crate::{AppState, cache_service::CacheGetOptions};

type Params = Vec<(String, String)>;

/// 查询值只解码一次，保留重复参数及未知参数，不使用管理后台 DTO。
fn parse_query(query: Option<String>) -> Params {
    let mut url = reqwest::Url::parse("https://localhost/").expect("固定 URL 有效");
    url.set_query(query.as_deref());
    url.query_pairs().map(|(k,v)| (k.into_owned(), v.into_owned())).collect()
}

pub async fn search_anime(State(state): State<Arc<AppState>>, RawQuery(query): RawQuery) -> Response {
    let mut params = parse_query(query);
    // 兼容旧客户端 anime 参数，但不覆盖明确提供的 keyword。
    // 仅单个兼容参数可改名；重复 anime 必须完整交还上游，不能折叠成首项。
    if !params.iter().any(|(k,_)| k == "keyword")
        && params.iter().filter(|(k,_)| k == "anime").count() == 1 {
        if let Some((_, value)) = params.iter().find(|(k,_)| k == "anime") {
            let value = value.clone();
            params.retain(|(k,_)| k != "anime");
            params.push(("keyword".into(), value));
        }
    }
    catalog_response(&state, "search/anime", params, None).await
}

pub async fn search_episodes(State(state): State<Arc<AppState>>, RawQuery(query): RawQuery) -> Response {
    let mut params = parse_query(query);
    let episode_params: Vec<_> = params.iter().filter(|(k,_)| k == "episode").collect();
    // 重复分集参数的解释交还上游，不可只取第一项后把其余值一起删除。
    let episode = if episode_params.len() == 1 { Some(episode_params[0].1.trim().to_owned()) } else { None }
        .filter(|v| !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()));
    // SP/movie 等非数字值必须完整回源，不能归并成数字分集。
    if episode.is_some() { params.retain(|(k,_)| k != "episode"); }
    catalog_response(&state, "search/episodes", params, episode.as_deref()).await
}

pub async fn get_bangumi(State(state): State<Arc<AppState>>, Path(id): Path<String>, RawQuery(query): RawQuery) -> Response {
    // 官方支持数字 ID 与 tmdb-movie-21832 等外部标识，只放行安全路径字符。
    if id.is_empty() || id.len() > 128 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_')) {
        return (StatusCode::BAD_REQUEST, "番剧 ID 格式无效").into_response();
    }
    catalog_response(&state, &format!("bangumi/{id}"), parse_query(query), None).await
}

/// 与 Worker 的解码值缓存键兼容；URL 的实际传输仍通过编码器防止参数注入。
fn catalog_key(path: &str, query: &Params) -> String {
    // 解码后的分隔符不能直接拼接到 Worker 旧格式；摘要隔离后只允许边界摄取重建。
    // 保留完整参数顺序和重复项，不能与另一组真实查询参数碰撞。
    if query.iter().any(|(key, value)| key.contains(['&','=']) || value.contains(['&','='])) {
        let identity = serde_json::to_vec(&(path, query)).expect("查询元组可序列化");
        return format!("HTTP-SHA256:{:x}", Sha256::digest(identity));
    }
    let mut pairs: Vec<_> = query.iter().filter(|(k,_)| k != "_t" && k != "timestamp").collect();
    pairs.sort_by(|a,b| a.0.cmp(&b.0));
    let params = pairs.into_iter().map(|(k,v)| format!("{k}={v}")).collect::<Vec<_>>().join("&");
    let base = format!("GET:/api/v2/{path}");
    if params.is_empty() { base } else { format!("{base}?{params}") }
}

fn json_response(status: u16, body: String, episode: Option<&str>) -> Response {
    let body = episode.and_then(|ep| extract_episode(&body, ep)).unwrap_or(body);
    (StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY), [(header::CONTENT_TYPE, "application/json; charset=utf-8")], body).into_response()
}

/// 抽不到时返回整季，与 Worker 一致；不会丢失番剧、分集或顶层未知字段。
fn extract_episode(body: &str, want: &str) -> Option<String> {
    let mut data: Value = serde_json::from_str(body).ok()?;
    let animes = data.get_mut("animes")?.as_array_mut()?;
    let title_number = regex::Regex::new(r"第\s*(\d+)\s*[话集]").ok()?;
    let picked: Vec<Value> = animes.iter().filter_map(|anime| {
        let anime_id = anime.get("animeId").map(value_text).unwrap_or_default();
        let episodes = anime.get("episodes")?.as_array()?;
        let hits: Vec<Value> = episodes.iter().filter(|ep| {
            let mut n = ep.get("episodeNumber").filter(|v| !v.is_null()).map(value_text).filter(|v| !v.is_empty());
            if n.is_none() {
                n = ep.get("episodeTitle").and_then(Value::as_str).and_then(|s| title_number.captures(s)).map(|m| m[1].to_string());
            }
            if n.is_none() && !anime_id.is_empty() && anime_id.bytes().all(|b| b.is_ascii_digit()) {
                n = ep.get("episodeId").map(value_text).and_then(|id| id.strip_prefix(&anime_id).map(str::to_owned))
                    .filter(|v| !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()));
            }
            n.is_some_and(|n| n.trim() == want || decimal_equal(n.trim(), want))
        }).cloned().collect();
        if hits.is_empty() { return None; }
        let mut selected = anime.clone();
        selected["episodes"] = Value::Array(hits);
        Some(selected)
    }).collect();
    if picked.is_empty() { return None; }
    *animes = picked;
    serde_json::to_string(&data).ok()
}

fn value_text(v: &Value) -> String { v.as_str().map(str::to_owned).unwrap_or_else(|| v.to_string()) }
fn decimal_equal(a: &str, b: &str) -> bool {
    !a.is_empty() && !b.is_empty() && a.bytes().all(|c| c.is_ascii_digit()) && b.bytes().all(|c| c.is_ascii_digit())
        && a.trim_start_matches('0') == b.trim_start_matches('0')
}

async fn catalog_response(state: &AppState, path: &str, mut query: Params, episode: Option<&str>) -> Response {
    let mut key = catalog_key(path, &query);
    // 别名最多重写一次，避免循环；未审核别名由实体服务拒绝。
    for attempt in 0..2 {
        match state.cache.get_payload(&key, CacheGetOptions::default()).await {
            Ok(payload) if payload.get("hit").and_then(Value::as_bool) == Some(true) => {
                if let Some(body) = payload.get("body").and_then(Value::as_str) {
                    return json_response(payload.get("status").and_then(Value::as_u64).unwrap_or(200) as u16, body.into(), episode);
                }
            }
            Ok(payload) if attempt == 0 && payload.get("alias_hit").and_then(Value::as_bool) == Some(true) => {
                if let Some(canonical) = payload.get("canonical").and_then(Value::as_str) {
                    let term = if path == "search/anime" { "keyword" } else { "anime" };
                    for (k,v) in &mut query { if k == term { *v = canonical.to_string(); } }
                    key = catalog_key(path, &query);
                    continue;
                }
            }
            Err(e) => tracing::warn!("目录缓存读取失败，继续回源: {e}"),
            _ => {}
        }
        break;
    }
    let mut url = reqwest::Url::parse(&format!("https://api.dandanplay.net/api/v2/{path}")).expect("固定上游 URL 有效");
    if !query.is_empty() { url.query_pairs_mut().extend_pairs(&query); }
    // 不丢弃非 2xx 的上游 JSON，状态和业务错误应一起返回，且失败不写缓存。
    let client = match crate::dandanplay_upstream::client() {
        Ok(c) => c,
        Err(_) => return (StatusCode::BAD_GATEWAY, "无法初始化弹弹接口请求").into_response(),
    };
    // 签名使用 pathname，不包含查询参数；缺少应用凭据不发匿名请求。
    let request = match crate::dandanplay_upstream::authorize(&state.db, client.get(url.clone()), url.path()).await {
        Ok(request) => request,
        Err(message) => return (StatusCode::SERVICE_UNAVAILABLE, message).into_response(),
    };
    let response = match request.send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("弹弹目录回源失败: {path}: {e}");
            return (StatusCode::BAD_GATEWAY, "无法获取弹弹接口响应").into_response();
        }
    };
    let status = response.status().as_u16();
    let content_type = response.headers().get(header::CONTENT_TYPE).cloned();
    let bytes = match response.bytes().await {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_GATEWAY, "弹弹接口响应读取失败").into_response(),
    };
    if (200..300).contains(&status) {
        let Ok(body) = std::str::from_utf8(&bytes) else {
            return (StatusCode::BAD_GATEWAY, "上游目录成功响应不是有效 UTF-8 JSON").into_response();
        };
        let Ok(value) = serde_json::from_str::<Value>(body) else {
            return (StatusCode::BAD_GATEWAY, "上游目录成功响应不是有效 JSON").into_response();
        };
        // 仅明确的业务失败可原样交还；畸形 errorCode 不是失败协议的证据。
        let code = value.get("errorCode");
        if code.is_some_and(|code| code.as_i64().is_none()) {
            return (StatusCode::BAD_GATEWAY, "上游目录 errorCode 必须为整数").into_response();
        }
        let business_failure = value.get("success") == Some(&Value::Bool(false))
            || code.and_then(Value::as_i64).is_some_and(|code| code != 0);
        if !business_failure {
            let record = json!({"cache_key":key,"api_path":format!("/api/v2/{path}"),"method":"GET","url":url.as_str(),"body":body,"status":status});
            // 包括空结果在内的成功响应必须字段化；不能因准入失败回放原 bytes。
            match state.cache.upsert_record(&record).await {
                Ok(true) => match crate::entity_service::EntityService::new(state.db.clone())
                    .reconstruct_ingested(&key, &format!("/api/v2/{path}"), body).await {
                    Ok(Some(assembled)) => return json_response(status, assembled, episode),
                    Ok(None) => return (StatusCode::BAD_GATEWAY, "目录响应缺少可组装的结构化数据").into_response(),
                    Err(e) => {
                        tracing::warn!("目录字段响应组装失败: {e}");
                        return (StatusCode::BAD_GATEWAY, "目录字段响应组装失败").into_response();
                    }
                },
                Ok(false) => return (StatusCode::BAD_GATEWAY, "上游目录响应不符合结构化协议").into_response(),
                Err(e) => {
                    tracing::warn!("目录响应入库失败: {e}");
                    return (StatusCode::BAD_GATEWAY, "目录结构化数据保存失败").into_response();
                }
            }
        }
    }
    let mut result = (StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY), bytes).into_response();
    if let Some(value) = content_type { result.headers_mut().insert(header::CONTENT_TYPE, value); }
    result
}
