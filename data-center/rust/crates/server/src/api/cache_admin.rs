//! 旧响应缓存管理接口：只供管理员诊断，不作为业务响应的数据源。
use axum::{extract::{Path, Query, State}, http::StatusCode, routing::{get, post}, Json, Router};
use db::entities::api_response_cache::{self as cache, Column, Entity, Model};
use sea_orm::{sea_query::Expr, ActiveModelTrait, ColumnTrait, Condition, ConnectionTrait, DbBackend, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Select, Set};
use serde::Deserialize;
use serde_json::{json, Value};
use crate::AppState;

type ApiError = (StatusCode, Json<Value>);
type ApiResult = Result<Json<Value>, ApiError>;

/// 由调用方挂载 JWT 与管理员中间件，本模块不提供公开业务缓存读取。
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/cache/stats", get(stats))
        .route("/cache/responses", get(list))
        .route("/cache/responses/{id}", get(detail).delete(remove))
        .route("/cache/responses/{id}/mark-refresh", post(mark_refresh))
        .route("/cache/responses/{id}/ttl", post(set_ttl))
}

fn error(status: StatusCode, message: &str) -> ApiError {
    (status, Json(json!({"message": message})))
}
fn db_error(err: sea_orm::DbErr) -> ApiError {
    tracing::error!(error = %err, "旧缓存管理数据库操作失败");
    error(StatusCode::INTERNAL_SERVER_ERROR, "缓存数据库操作失败")
}
fn valid_id(id: i64) -> Result<(), ApiError> {
    if id <= 0 { return Err(error(StatusCode::BAD_REQUEST, "ID 必须为正整数")); }
    Ok(())
}
async fn find(state: &AppState, id: i64) -> Result<Model, ApiError> {
    valid_id(id)?;
    Entity::find_by_id(id).one(&state.db).await.map_err(db_error)?
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "缓存记录不存在"))
}

// 字段严格映射现有 SeaORM 实体；不虚构来源、TTL 或 Redis 命中状态。
fn fields(row: &Model) -> Value {
    json!({
        "id": row.id, "cache_key": row.cache_key, "source": row.source,
        "method": row.method, "api_path": row.api_path,
        "normalized_query": row.normalized_query, "query_json": row.query_json,
        "request_body_hash": row.request_body_hash, "request_body_json": row.request_body_json,
        "client_ip": row.client_ip, "status_code": row.status_code,
        "response_headers_json": row.response_headers_json,
        "redis_key": row.redis_key, "storage_mode": row.storage_mode,
        "body_hash": row.body_hash, "body_size": row.body_size,
        "fetched_at": row.fetched_at, "last_used_at": row.last_used_at,
        "last_refresh_at": row.last_refresh_at, "refresh_after": row.refresh_after,
        "expire_at": row.expire_at, "refresh_pending": row.refresh_pending,
        "hit_count": row.hit_count, "stale_hit_count": row.stale_hit_count,
        "upstream_429_count": row.upstream_429_count, "is_empty": row.is_empty,
        "created_at": row.created_at, "updated_at": row.updated_at
    })
}

/// MySQL 的 SUM(INT) 返回 DECIMAL，先显式转换为驱动可解码的有符号 64 位整数。
/// 其余数据库使用 BIGINT；保留 SUM 空集合为 NULL 的语义，再由接口归零。
pub(crate) fn total_bytes_query(backend: DbBackend) -> Select<Entity> {
    let aggregate = match backend {
        DbBackend::MySql => "CAST(SUM(body_size) AS SIGNED)",
        _ => "CAST(SUM(body_size) AS BIGINT)",
    };
    Entity::find().select_only().column_as(Expr::cust(aggregate), "total_bytes")
}

async fn stats(State(state): State<AppState>) -> ApiResult {
    let now = chrono::Utc::now().naive_utc();
    let total = Entity::find().count(&state.db).await.map_err(db_error)?;
    let expired = Entity::find().filter(Column::ExpireAt.lte(now)).count(&state.db).await.map_err(db_error)?;
    let pending = Entity::find().filter(Column::RefreshPending.eq(true)).count(&state.db).await.map_err(db_error)?;
    let sql_count = Entity::find().filter(Column::StorageMode.eq("sql")).count(&state.db).await.map_err(db_error)?;
    let bytes = total_bytes_query(state.db.get_database_backend())
        .into_tuple::<Option<i64>>().one(&state.db).await.map_err(db_error)?.flatten().unwrap_or(0);
    // Redis 未提供可靠的命名空间计数 API，不能把 SQL 元数据计数冒充 Redis 实测。
    Ok(Json(json!({"data": {"total":total, "expired":expired, "refresh_pending":pending,
        "redis_count":null, "sql_count":sql_count, "total_bytes":bytes}})))
}

#[derive(Deserialize)]
struct ListQuery {
    page: Option<u64>, page_size: Option<u64>, keyword: Option<String>,
    api_path: Option<String>, client_ip: Option<String>,
    refresh_pending: Option<bool>, is_empty: Option<bool>,
}
async fn list(State(state): State<AppState>, Query(q): Query<ListQuery>) -> ApiResult {
    let page = q.page.unwrap_or(1);
    let size = q.page_size.unwrap_or(20);
    if page == 0 || size == 0 || size > 200 || (page - 1).checked_mul(size).is_none_or(|v| v > i64::MAX as u64) {
        return Err(error(StatusCode::BAD_REQUEST, "page 必须为正整数，page_size 范围为 1..200，分页偏移不可溢出"));
    }
    let mut select = Entity::find();
    if let Some(keyword) = q.keyword.filter(|s| !s.is_empty()) {
        select = select.filter(Condition::any().add(Column::CacheKey.contains(&keyword))
            .add(Column::ApiPath.contains(&keyword)).add(Column::Source.contains(&keyword)));
    }
    if let Some(path) = q.api_path.filter(|s| !s.is_empty()) { select = select.filter(Column::ApiPath.eq(path)); }
    if let Some(ip) = q.client_ip.filter(|s| !s.is_empty()) { select = select.filter(Column::ClientIp.eq(ip)); }
    if let Some(flag) = q.refresh_pending { select = select.filter(Column::RefreshPending.eq(flag)); }
    if let Some(flag) = q.is_empty { select = select.filter(Column::IsEmpty.eq(flag)); }
    let total = select.clone().count(&state.db).await.map_err(db_error)?;
    let rows = select.order_by_desc(Column::Id).offset((page - 1) * size).limit(size).all(&state.db).await.map_err(db_error)?;
    Ok(Json(json!({"items":rows.iter().map(fields).collect::<Vec<_>>(), "total":total})))
}
async fn detail(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult {
    let row = find(&state, id).await?;
    let mut data = fields(&row);
    data["response_body"] = json!(row.response_body);
    data["body"] = json!(row.response_body);
    data["body_note"] = json!("旧响应缓存原文，仅用于管理诊断，不是业务读取源；未读取 Redis 响应体");
    Ok(Json(json!({"data":data})))
}

async fn invalidate(state: &AppState, row: &Model) -> Result<(), ApiError> {
    // 只删除该行的真实键，绝不通配清库。失败时不谎报修改成功。
    if let Some(key) = row.redis_key.as_deref().filter(|s| !s.is_empty()) {
        if state.redis.is_enabled() {
            if !state.redis.del(key).await { return Err(error(StatusCode::SERVICE_UNAVAILABLE, "Redis 失效失败，未修改 SQL 缓存")); }
        } else if row.storage_mode == "redis" {
            return Err(error(StatusCode::SERVICE_UNAVAILABLE, "Redis 不可用，无法安全失效该热缓存"));
        }
    } else if row.storage_mode == "redis" {
        return Err(error(StatusCode::CONFLICT, "Redis 缓存缺少真实键，无法安全失效"));
    }
    Ok(())
}
async fn mark_refresh(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult {
    let row = find(&state, id).await?;
    invalidate(&state, &row).await?;
    let now = chrono::Utc::now().naive_utc();
    let mut active: cache::ActiveModel = row.into();
    active.refresh_pending = Set(true);
    active.refresh_after = Set(now);
    active.updated_at = Set(now);
    active.update(&state.db).await.map_err(db_error)?;
    Ok(Json(json!({"data":{"id":id,"refresh_pending":true}, "message":"已标记待刷新，未执行上游刷新"})))
}
async fn remove(State(state): State<AppState>, Path(id): Path<i64>) -> ApiResult {
    let row = find(&state, id).await?;
    invalidate(&state, &row).await?;
    Entity::delete_by_id(id).exec(&state.db).await.map_err(db_error)?;
    Ok(Json(json!({"data":{"id":id,"deleted":true}})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TtlBody { ttl_seconds: i64 }
async fn set_ttl(State(state): State<AppState>, Path(id): Path<i64>, Json(body): Json<TtlBody>) -> ApiResult {
    valid_id(id)?;
    // 有限的管理范围避免日期溢出；0 表示立即过期，不表示永不过期。
    if !(0..=31_536_000).contains(&body.ttl_seconds) {
        return Err(error(StatusCode::BAD_REQUEST, "ttl_seconds 范围为 0..31536000（最多一年）"));
    }
    let row = find(&state, id).await?;
    invalidate(&state, &row).await?;
    let now = chrono::Utc::now().naive_utc();
    let expire_at = now + chrono::Duration::seconds(body.ttl_seconds);
    let mut active: cache::ActiveModel = row.into();
    active.expire_at = Set(expire_at);
    active.updated_at = Set(now);
    active.update(&state.db).await.map_err(db_error)?;
    Ok(Json(json!({"data":{"id":id,"expire_at":expire_at}})))
}
