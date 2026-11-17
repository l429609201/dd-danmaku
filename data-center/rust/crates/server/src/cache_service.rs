use std::sync::Arc;

use anyhow::{Context, Result};
use db::{entities::api_response_cache, CacheRepo};
use sea_orm::{sea_query::{Expr, OnConflict}, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{entity_service::EntityService, redis_service::RedisCacheService,
    structured_response_store::StructuredResponseStore};

/// 共享查询策略；强制回源的 alias_only 仅由 get_payload 处理。
#[derive(Debug, Clone, Copy)]
pub struct CacheGetOptions<'a> {
    pub worker_request_id: Option<&'a str>,
    pub client_ip: Option<&'a str>,
    pub log_miss: bool,
    pub allow_stale: bool,
    pub alias_only: bool,
}

impl Default for CacheGetOptions<'_> {
    fn default() -> Self {
        Self { worker_request_id: None, client_ip: None, log_miss: true, allow_stale: false, alias_only: false }
    }
}

/// 保留旧调用方的三个字段，并透传 Worker 需要的时间、响应头和降级标记。
#[derive(Debug, Clone)]
pub struct CachedResponse {
    pub body: String,
    pub status_code: i32,
    pub storage_mode: String,
    pub headers: Value,
    pub cached_at: i64,
    pub stale: bool,
    pub served_stale: bool,
    pub is_empty: bool,
    pub assembled: bool,
}

impl CachedResponse {
    pub fn payload(&self) -> Value {
        json!({"hit": true, "status": self.status_code, "headers": self.headers,
            "body": self.body, "cached_at": self.cached_at, "stale": self.stale,
            "served_stale": self.served_stale, "is_empty": self.is_empty, "assembled": self.assembled})
    }
}

/// SQL 保留冷备，Redis 只是可选热层；旧 new/get/set 调用仍可使用。
pub struct CacheService {
    repo: CacheRepo,
    db: DatabaseConnection,
    redis: Option<Arc<RedisCacheService>>,
    entities: EntityService,
    structured: StructuredResponseStore,
}

impl CacheService {
    pub fn new(db: DatabaseConnection) -> Self {
        Self { repo: CacheRepo::new(db.clone()), entities: EntityService::new(db.clone()),
            structured: StructuredResponseStore::new(db.clone()), db, redis: None }
    }

    /// 复用主线程的 Redis 连接，避免同步构造函数偷偷启动连接任务。
    pub fn with_redis(mut self, redis: Arc<RedisCacheService>) -> Self {
        self.redis = Some(redis);
        self
    }

    pub async fn get(&self, cache_key: &str) -> Result<Option<CachedResponse>> {
        self.get_with_options(cache_key, CacheGetOptions::default()).await
    }

    /// RPC 与公共接口共享 miss/负缓存别名改写；返回 hit:false 不代表允许直接返回空响应。
    pub async fn get_payload(&self, cache_key: &str, options: CacheGetOptions<'_>) -> Result<Value> {
        if cache_key.is_empty() {
            return Ok(json!({"hit": false}));
        }
        if options.alias_only {
            return Ok(self.resolve_alias(cache_key).await.unwrap_or_else(|| json!({"hit": false})));
        }
        let cached = self.get_with_options(cache_key, options).await?;
        if cached.as_ref().map_or(true, |c| c.is_empty) {
            if let Some(alias) = self.resolve_alias(cache_key).await {
                return Ok(alias);
            }
        }
        Ok(cached.map(|c| c.payload()).unwrap_or_else(|| json!({"hit": false})))
    }

    async fn resolve_alias(&self, cache_key: &str) -> Option<Value> {
        match self.entities.resolve_search_term(cache_key).await {
            Ok(Some(mut result)) if result.is_object() => {
                result["hit"] = Value::Bool(false);
                Some(result)
            }
            Ok(_) => None,
            Err(error) => {
                tracing::debug!(%error, "别名改写失败，继续原缓存流程");
                None
            }
        }
    }

    pub async fn get_with_options(&self, cache_key: &str, options: CacheGetOptions<'_>) -> Result<Option<CachedResponse>> {
        // alias_only 是硬边界：此入口也不得读取响应体或触发实体拼装。
        if cache_key.is_empty() || options.alias_only {
            return Ok(None);
        }
        // 目录响应以规范化字段为唯一读源；即使旧 SQL/Redis 响应存在，也不能覆盖实体修改。
        // 拼装不完整或失败必须回源，开关也不得重新启用旧 JSON 兜底；EMPTY: 不属于此分支。
        // match/comment 使用 Worker 原键隔离请求，不能与 HTTP 的 structured-v1 键混用。
        if let Some(path) = structured_protocol_key(cache_key) {
            match self.structured.get(path, cache_key).await {
                Ok(Some(value)) => return Ok(Some(CachedResponse {
                    body: serde_json::to_string(&value)?, status_code: 200, storage_mode: "assembled".into(),
                    headers: json!({"content-type": "application/json; charset=utf-8", "X-Cache-Source": "assembled-protocol"}),
                    cached_at: 0, stale: false, served_stale: false, is_empty: false, assembled: true,
                })),
                Err(error) => tracing::warn!(%error, "协议字段拼装失败，转回源"),
                _ => {}
            }
            self.log_miss(cache_key, "protocol_incomplete", options);
            return Ok(None);
        }
        // 所有目录键都是字段边界；未知参数由 assemble 拒绝并回源，不能借旧 JSON 绕过。
        if catalog_key(cache_key) {
            match self.entities.assemble(cache_key).await {
                Ok(Some(result)) => {
                    if let Some(body) = result.get("body").and_then(Value::as_str) {
                        let mode = result.get("mode").and_then(Value::as_str).unwrap_or("entity");
                        return Ok(Some(CachedResponse {
                            body: body.to_string(), status_code: 200, storage_mode: "assembled".into(),
                            headers: json!({"content-type": "application/json; charset=utf-8", "X-Cache-Source": format!("assembled-{mode}")}),
                            cached_at: 0, stale: false, served_stale: false, is_empty: false, assembled: true,
                        }));
                    }
                }
                Err(error) => tracing::warn!(%error, "实体拼装失败，转回源"),
                _ => {}
            }
            self.log_miss(cache_key, "entities_incomplete", options);
            return Ok(None);
        }
        let Some(cache) = self.repo.find_by_key(cache_key).await.context("查询响应缓存失败")? else {
            self.log_miss(cache_key, "miss", options);
            return Ok(None);
        };
        let now = chrono::Utc::now().naive_utc();
        let served_stale = now >= cache.expire_at;
        if served_stale && !options.allow_stale {
            self.log_miss(cache_key, "expired", options);
            return Ok(None);
        }
        let redis = self.redis.as_ref().filter(|_| redis_storage_enabled());
        let mut body = None;
        if cache.storage_mode == "redis" {
            if let (Some(redis), Some(key)) = (redis, cache.redis_key.as_deref()) {
                body = redis.get(key).await;
            }
        }
        let redis_hit = body.is_some();
        if body.is_none() {
            body = cache.response_body.clone();
        }
        let Some(body) = body.filter(|body| !body.is_empty()) else {
            self.log_miss(cache_key, "body_missing", options);
            return Ok(None);
        };
        // 旧 SQL 冷备及 Redis 热值同样必须过准入校验，脏记录不得续期或改用实体掩盖。
        if cache.status_code != 200 || !cacheable_body(&cache.api_path, &body, cache.is_empty) {
            self.log_miss(cache_key, "dirty_body", options);
            return Ok(None);
        }
        // 自愈只预热剩余有效期，不把负缓存/过期降级意外续成新的完整 TTL。
        let mut rewarmed = false;
        let remaining = (cache.expire_at - now).num_seconds();
        if !redis_hit && remaining > 0 {
            if let (Some(redis), Some(key)) = (redis, cache.redis_key.as_deref()) {
                rewarmed = redis.set(key, &body, remaining as u64).await;
            }
        }
        // 已有整季缓存不应遮住本地新增季度；先记录派生值，统一 touch 后再返回。
        let mut series_body = None;
        if !cache_key.starts_with("EMPTY:") && env_bool("ENTITY_ASSEMBLE_ENABLED", true) {
            match self.entities.series_override(cache_key, &body).await {
                Ok(Some(result)) => {
                    series_body = result.get("body").and_then(Value::as_str).map(str::to_owned);
                }
                Err(error) => tracing::warn!(%error, "系列拼装失败，继续使用原缓存"),
                _ => {}
            }
        }
        let stale = now >= cache.refresh_after || served_stale;
        // 原子递增避免并发查询覆盖计数；命中记录失败不能使可用响应变成错误。
        let mut touch = api_response_cache::Entity::update_many()
            .col_expr(api_response_cache::Column::HitCount, Expr::col(api_response_cache::Column::HitCount).add(1))
            .col_expr(api_response_cache::Column::LastUsedAt, Expr::value(now))
            .col_expr(api_response_cache::Column::UpdatedAt, Expr::value(now));
        if stale {
            touch = touch.col_expr(api_response_cache::Column::RefreshPending, Expr::value(true))
                .col_expr(api_response_cache::Column::StaleHitCount, Expr::col(api_response_cache::Column::StaleHitCount).add(1));
        }
        if rewarmed {
            touch = touch.col_expr(api_response_cache::Column::StorageMode, Expr::value("redis"));
        }
        if let Err(error) = touch.filter(api_response_cache::Column::Id.eq(cache.id)).exec(&self.db).await {
            tracing::warn!(%error, "更新缓存命中状态失败");
        }
        // 派生覆盖仍属于本次缓存命中：保留原始获取时间与过期降级语义，不能伪装新鲜。
        if let Some(body) = series_body {
            let mut headers = response_headers(cache.response_headers_json);
            headers["X-Cache-Source"] = json!("assembled-series");
            return Ok(Some(CachedResponse {
                body, status_code: 200, storage_mode: "assembled".into(), headers,
                cached_at: cache.fetched_at.and_utc().timestamp_millis(), stale, served_stale,
                is_empty: false, assembled: true,
            }));
        }
        Ok(Some(CachedResponse {
            body, status_code: cache.status_code,
            storage_mode: if rewarmed { "redis".into() } else { cache.storage_mode },
            headers: response_headers(cache.response_headers_json),
            cached_at: cache.fetched_at.and_utc().timestamp_millis(), stale, served_stale,
            is_empty: cache.is_empty, assembled: false,
        }))
    }

    fn log_miss(&self, cache_key: &str, reason: &str, options: CacheGetOptions<'_>) {
        // 当前 Rust schema 无访问日志表，不编造旧表；预查仅抑制 miss 日志。
        if options.log_miss {
            tracing::debug!(cache_key, reason, worker_request_id = options.worker_request_id,
                client_ip = options.client_ip, "响应缓存未命中");
        }
    }

    pub async fn set(&self, cache_key: &str, response_body: &str, status_code: i32, ttl_seconds: i64) -> Result<()> {
        let api_path = cache_key.split_once(':').map(|(_, path)| path).unwrap_or(cache_key)
            .split('?').next().unwrap_or_default();
        let record = json!({"cache_key": cache_key, "api_path": api_path, "body": response_body,
            "status": status_code, "ttl": ttl_seconds});
        self.upsert_record(&record).await?;
        Ok(())
    }

    /// 只写真实成功响应；调用方显式 is_empty 的搜索负缓存须再次验证。
    pub async fn upsert_record(&self, record: &Value) -> Result<bool> {
        let cache_key = string(record, "cache_key");
        let api_path = string(record, "api_path");
        let body = string(record, "body");
        let status = record.get("status").and_then(Value::as_i64).unwrap_or(200);
        let is_empty = record.get("is_empty").and_then(Value::as_bool).unwrap_or(false);
        // EMPTY 键只能显式声明负缓存，不能误写为普通搜索的零成员证据。
        if cache_key.is_empty() || (cache_key.starts_with("EMPTY:") && !is_empty)
            || status != 200 || !cacheable_body(api_path, body, is_empty) {
            return Ok(false);
        }
        let ttl = record.get("ttl").and_then(Value::as_i64).filter(|ttl| *ttl > 0)
            .unwrap_or_else(|| env_seconds(if is_empty { "EMPTY_CACHE_TTL_SECONDS" } else { "CACHE_STALE_MAX_AGE_SECONDS" }, if is_empty { 6 * 3600 } else { 30 * 86400 }));
        let refresh = env_seconds("CACHE_REFRESH_INTERVAL_SECONDS", 6 * 3600).min(ttl);
        let now = chrono::Utc::now().naive_utc();
        let expire_at = chrono::Duration::try_seconds(ttl).and_then(|ttl| now.checked_add_signed(ttl))
            .context("缓存 TTL 超出时间范围")?;
        let refresh_after = now.checked_add_signed(chrono::Duration::seconds(refresh)).context("刷新 TTL 超出时间范围")?;
        // 协议摄取同样先事务提交；字段验证失败不得写入任何原始响应作为后备。
        if let Some(path) = structured_protocol_path(api_path) {
            let value: Value = serde_json::from_str(body).context("解析协议响应失败")?;
            if self.structured.ingest(path, cache_key, &value).await.context("写入协议规范化字段失败")?.is_none() {
                return Ok(false);
            }
            return Ok(true);
        }
        // 目录摄取必须先成功提交：解析/字段写入失败不能先写旧 JSON 再向同步调用方报成功。
        if !is_empty && catalog_path(api_path) {
            self.entities.ingest(cache_key, api_path, body).await.context("写入目录规范化实体失败")?;
            // 目录字段已提交，不再重复保存完整 JSON 到 SQL 或 Redis。
            return Ok(true);
        }
        let redis_key = format!("api:response:{}", sha256(cache_key));
        let mut storage_mode = "sql";
        // SQL 冷备始终保留；Redis 故障只改变热层标记，不影响可用性。
        if redis_storage_enabled() {
            if let Some(redis) = &self.redis {
                if redis.set(&redis_key, body, ttl as u64).await {
                    storage_mode = "redis";
                }
            }
        }
        let request_body = record.get("request_body").filter(|v| !v.is_null()).map(|v| {
            v.as_str().map(|raw| serde_json::from_str(raw).unwrap_or_else(|_| json!({"raw": raw})))
                .unwrap_or_else(|| v.clone())
        });
        let model = api_response_cache::ActiveModel {
            cache_key: Set(cache_key.into()), source: Set(record.get("source").and_then(Value::as_str).unwrap_or("dandanplay").into()),
            method: Set(record.get("method").and_then(Value::as_str).unwrap_or("GET").into()), api_path: Set(api_path.into()),
            normalized_query: Set(optional_string(record, "normalized_query")), query_json: Set(optional_value(record, "query")),
            request_body_hash: Set(optional_string(record, "request_body_hash")), request_body_json: Set(request_body),
            client_ip: Set(optional_string(record, "client_ip")), status_code: Set(status as i32),
            response_headers_json: Set(optional_value(record, "headers")), response_body: Set(Some(body.into())),
            redis_key: Set(Some(redis_key)), storage_mode: Set(storage_mode.into()),
            body_hash: Set(optional_string(record, "body_hash").unwrap_or_else(|| format!("sha256:{}", sha256(body)))),
            body_size: Set(i32::try_from(body.len()).context("响应体过大")?), fetched_at: Set(now),
            last_used_at: Set(None), last_refresh_at: Set(Some(now)), refresh_after: Set(refresh_after), expire_at: Set(expire_at),
            refresh_pending: Set(false), hit_count: Set(0), stale_hit_count: Set(0), upstream_429_count: Set(0),
            is_empty: Set(is_empty), created_at: Set(now), updated_at: Set(now), ..Default::default()
        };
        // repo.upsert 的 save 不按 cache_key 冲突更新；明确使用真实唯一键，保留历史计数及创建时间。
        use api_response_cache::Column as C;
        api_response_cache::Entity::insert(model).on_conflict(
            OnConflict::column(C::CacheKey).update_columns([
                C::Source, C::Method, C::ApiPath, C::NormalizedQuery, C::QueryJson, C::RequestBodyHash,
                C::RequestBodyJson, C::ClientIp, C::StatusCode, C::ResponseHeadersJson, C::ResponseBody,
                C::RedisKey, C::StorageMode, C::BodyHash, C::BodySize, C::FetchedAt, C::LastRefreshAt,
                C::RefreshAfter, C::ExpireAt, C::RefreshPending, C::IsEmpty, C::UpdatedAt,
            ]).to_owned()
        ).exec_without_returning(&self.db).await.context("写入响应缓存失败")?;
        Ok(true)
    }
}

/// 目录路径无论参数是否可拼装都不得返回原始响应；EMPTY: 负缓存例外。
fn catalog_key(key: &str) -> bool {
    let Some((method, target)) = key.split_once(':') else { return false; };
    method != "EMPTY" && catalog_path(target.split('?').next().unwrap_or(target))
}

/// Worker 的 match/comment 键保留完整查询和请求摘要，仅提取路径选择字段协议。
fn structured_protocol_key(key: &str) -> Option<&str> {
    let (method, target) = key.split_once(':')?;
    if method == "EMPTY" { return None; }
    structured_protocol_path(target.split('?').next().unwrap_or(target))
}

fn structured_protocol_path(path: &str) -> Option<&str> {
    let path = path.strip_prefix("/api/v2/")?;
    if path == "match" || path.strip_prefix("comment/")
        .is_some_and(|id| !id.is_empty() && !id.contains(['/','#'])) { Some(path) } else { None }
}

fn catalog_path(path: &str) -> bool {
    matches!(path, "/api/v2/search/anime" | "/api/v2/search/episodes")
        || path.strip_prefix("/api/v2/bangumi/").is_some_and(|id| !id.is_empty() && !id.contains('/'))
}

fn string<'a>(record: &'a Value, name: &str) -> &'a str {
    record.get(name).and_then(Value::as_str).unwrap_or_default()
}

fn optional_string(record: &Value, name: &str) -> Option<String> {
    record.get(name).and_then(Value::as_str).filter(|v| !v.is_empty()).map(str::to_owned)
}

fn optional_value(record: &Value, name: &str) -> Option<Value> {
    record.get(name).filter(|v| !v.is_null()).cloned()
}

fn sha256(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

fn env_seconds(name: &str, default: i64) -> i64 {
    std::env::var(name).ok().and_then(|v| v.parse().ok()).filter(|v| *v > 0).unwrap_or(default)
}

fn env_bool(name: &str, default: bool) -> bool {
    std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn redis_storage_enabled() -> bool {
    std::env::var("CACHE_BODY_STORAGE").unwrap_or_else(|_| "redis".into()).eq_ignore_ascii_case("redis")
}

fn response_headers(headers: Option<Value>) -> Value {
    let mut headers = headers.filter(Value::is_object).unwrap_or_else(|| json!({}));
    if !headers.as_object().is_some_and(|h| h.iter().any(|(k, v)| k.eq_ignore_ascii_case("content-type") && v.as_str().is_some_and(|s| !s.is_empty()))) {
        headers["content-type"] = json!("application/json; charset=utf-8");
    }
    headers
}

fn cacheable_body(api_path: &str, body: &str, is_empty: bool) -> bool {
    let Ok(data) = serde_json::from_str::<Value>(body) else { return false; };
    // 非法错误码不应被当作成功；成功空搜索同样可拆为零成员的结构化结果。
    if !data.is_object() || data.get("success") == Some(&Value::Bool(false))
        || data.get("success").is_some_and(|value| !value.is_boolean())
        || data.get("errorCode").is_some_and(|code| !code.is_null() && code.as_i64() != Some(0)) {
        return false;
    }
    let search = api_path.contains("/search/anime") || api_path.contains("/search/episodes");
    if is_empty {
        return search && data.get("animes").and_then(Value::as_array).is_some_and(Vec::is_empty);
    }
    if search {
        return data.get("animes").and_then(Value::as_array).is_some();
    }
    if api_path.contains("/bangumi/") {
        let bangumi = data.get("bangumi").filter(|v| !v.is_null()).unwrap_or(&data);
        return bangumi.get("animeId").is_some_and(|v| v.as_i64().is_some_and(|id| id != 0) || v.as_str().is_some_and(|id| !id.is_empty()))
            || bangumi.get("animeTitle").and_then(Value::as_str).is_some_and(|s| !s.is_empty());
    }
    if api_path.contains("/match") {
        return data.get("isMatched").and_then(Value::as_bool).is_some()
            && data.get("matches").and_then(Value::as_array).is_some();
    }
    true
}

// 新增契约用例独立存放，避免继续扩张源文件中的旧内联测试。
#[cfg(test)]
#[path = "cache_parity_tests.rs"]
mod parity_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use db::{init_db, DbConfig, test_helper::create_test_schema};

    async fn setup_test_service() -> CacheService {
        let config = DbConfig::default();
        let db = init_db(&config).await.expect("Failed to init db");
        create_test_schema(&db).await.expect("Failed to create schema");
        CacheService::new(db)
    }

    #[tokio::test]
    async fn test_cache_service_set_and_get() {
        let service = setup_test_service().await;
        
        // 写入缓存
        service.set(
            "test:key:1",
            r#"{"success":true,"data":"test"}"#,
            200,
            3600,
        ).await.unwrap();
        
        // 读取缓存
        let result = service.get("test:key:1").await.unwrap();
        assert!(result.is_some());
        
        let cached = result.unwrap();
        assert_eq!(cached.status_code, 200);
        assert_eq!(cached.storage_mode, "sql");
        assert!(cached.body.contains("success"));
    }

    #[tokio::test]
    async fn test_cache_miss() {
        let service = setup_test_service().await;
        
        let result = service.get("nonexistent:key").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_cache_expiry() {
        let service = setup_test_service().await;
        
        // 写入一个 TTL 很短的缓存（1 秒）
        service.set(
            "test:expire:1",
            r#"{"data":"will expire"}"#,
            200,
            1,
        ).await.unwrap();
        
        // 立即读取应该成功
        let result = service.get("test:expire:1").await.unwrap();
        assert!(result.is_some());
        
        // 等待过期（2 秒）
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        
        // 再次读取应该失败
        let result = service.get("test:expire:1").await.unwrap();
        assert!(result.is_none());
    }
}
