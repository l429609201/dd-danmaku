//! 管理端分别展示规范化弹幕与旧文件归档；旧 JSON 不作为公共业务数据源。
use axum::{extract::{Path, Query, State}, http::StatusCode, routing::{get, post, put}, Json, Router};
use db::entities::{local_comment_store as legacy, structured_comment as comment, structured_response as response};
use sea_orm::{ColumnTrait, ConnectionTrait, DbBackend, EntityTrait, FromQueryResult, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Statement, TransactionTrait};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use crate::AppState;

type ApiResult = Result<Json<Value>, (StatusCode, Json<Value>)>;
fn error(status: StatusCode, code: &str, message: &str) -> (StatusCode, Json<Value>) {
    (status, Json(json!({"success":false,"error":code,"message":message})))
}
fn internal(err: impl std::fmt::Display) -> (StatusCode, Json<Value>) {
    tracing::error!(error = %err, "弹幕管理存储操作失败");
    error(StatusCode::INTERNAL_SERVER_ERROR, "storage_error", "弹幕存储操作失败，请检查服务日志")
}

/// 返回未加鉴权的管理路由，必须由调用方统一挂载 JWT 和管理员中间件。
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/comment-store/stats", get(stats))
        .route("/comment-store/entries", get(entries))
        .route("/comment-store/entries/{episode_id}", get(detail).delete(delete_entry))
        // 未实现的维护功能显式返回 501，不模拟成功或执行批量删除。
        .route("/comment-store/max-bytes", put(unsupported))
        .route("/comment-store/unlimited", put(unsupported))
        .route("/comment-store/cleanup", post(unsupported))
        .route("/comment-store/all", axum::routing::delete(unsupported))
        .route("/comment-store/r2-control", put(unsupported))
        .route("/comment-store/r2-task", get(unsupported))
        .route("/comment-store/r2-scan", post(unsupported))
        .route("/comment-store/r2-sync", post(unsupported))
}

pub async fn unsupported() -> ApiResult {
    Err(error(StatusCode::NOT_IMPLEMENTED, "not_implemented", "Rust 后端尚未实现配额、LRU、清空全部与 R2 维护能力；未修改任何数据"))
}

#[derive(Debug, Serialize, FromQueryResult)]
struct Entry {
    id: String,
    episode_id: String,
    storage_kind: String,
    comment_count: i64,
    size_bytes: Option<i64>,
    source: String,
    created_at: Option<chrono::NaiveDateTime>,
    last_used_at: Option<chrono::NaiveDateTime>,
    expires_at: Option<chrono::NaiveDateTime>,
    variant_count: i64,
}
impl Entry {
    fn value(&self) -> Value {
        let mut value = serde_json::to_value(self).expect("条目元数据可序列化");
        let normalized = self.storage_kind == "normalized";
        value["deletable"] = json!(normalized);
        value["delete_reason"] = if normalized { Value::Null } else { json!("旧文件和元数据无法跨文件系统与数据库原子删除，当前只读") };
        value
    }
}

/// 统一投影保留真实存储类型；规范化大小/写入时间未知，不用伪造值填充。
fn projection(backend: DbBackend) -> String {
    let (normal_id, legacy_id) = if backend == DbBackend::MySql {
        ("CASE WHEN r.api_path = 'extcomment' THEN CONCAT('extcomment:', r.request_key) ELSE SUBSTRING(r.api_path, 9) END", "CONCAT('legacy:', l.episode_id)")
    } else {
        ("CASE WHEN r.api_path = 'extcomment' THEN 'extcomment:' || r.request_key ELSE SUBSTR(r.api_path, 9) END", "'legacy:' || l.episode_id")
    };
    format!("SELECT {normal_id} AS id, {normal_id} AS episode_id, 'normalized' AS storage_kind, COUNT(c.ordinal) AS comment_count, NULL AS size_bytes, 'normalized' AS source, NULL AS created_at, NULL AS last_used_at, MAX(r.expires_at) AS expires_at, COUNT(DISTINCT r.request_key) AS variant_count FROM structured_responses r LEFT JOIN structured_comments c ON c.request_key = r.request_key WHERE r.api_path LIKE 'comment/%' OR r.api_path = 'extcomment' GROUP BY {normal_id} UNION ALL SELECT {legacy_id} AS id, {legacy_id} AS episode_id, 'legacy_json' AS storage_kind, l.comment_count, l.size_bytes, l.source, l.created_at, l.last_used_at, NULL AS expires_at, 1 AS variant_count FROM local_comment_store l")
}
fn placeholder(backend: DbBackend, index: usize) -> String {
    if backend == DbBackend::Postgres { format!("${index}") } else { "?".into() }
}

#[derive(Deserialize)]
pub struct ListQuery {
    #[serde(default = "one")] page: u64,
    #[serde(default = "twenty")] page_size: u64,
    #[serde(default = "default_sort")] sort: String,
    #[serde(default)] keyword: String,
}
fn one() -> u64 { 1 }
fn twenty() -> u64 { 20 }
fn default_sort() -> String { "created_at".into() }

pub async fn entries(State(state): State<AppState>, Query(query): Query<ListQuery>) -> ApiResult {
    let offset = query.page.checked_sub(1).and_then(|page| page.checked_mul(query.page_size));
    if !(1..=200).contains(&query.page_size) || offset.is_none_or(|n| n > i64::MAX as u64) || query.keyword.len() > 512 {
        return Err(error(StatusCode::BAD_REQUEST,"invalid_pagination","page 至少为 1，page_size 为 1 到 200，偏移不可溢出，keyword 最多 512 字节"));
    }
    let sort = match query.sort.as_str() {
        "created_at" => "created_at", "last_used_at" => "last_used_at",
        "comment_count" => "comment_count", "size_bytes" => "size_bytes",
        _ => return Err(error(StatusCode::BAD_REQUEST,"invalid_sort","不支持的排序字段")),
    };
    let backend = state.db.get_database_backend();
    let base = projection(backend);
    // 转义 LIKE 元字符，搜索只按字面匹配；排序字段由白名单决定。
    let keyword = format!("%{}%", query.keyword.replace('!',"!!").replace('%',"!%").replace('_',"!_"));
    let filter = format!("episode_id LIKE {} ESCAPE '!'", placeholder(backend,1));
    let count = state.db.query_one(Statement::from_sql_and_values(backend,
        format!("SELECT COUNT(*) AS total FROM ({base}) entries WHERE {filter}"), [keyword.clone().into()])).await.map_err(internal)?.ok_or_else(|| internal("缺少统计结果"))?;
    let total: i64 = count.try_get("", "total").map_err(internal)?;
    let sql = format!("SELECT * FROM ({base}) entries WHERE {filter} ORDER BY {sort} DESC, id ASC LIMIT {} OFFSET {}",placeholder(backend,2),placeholder(backend,3));
    let rows = state.db.query_all(Statement::from_sql_and_values(backend,sql,
        [keyword.into(), (query.page_size as i64).into(), (offset.unwrap() as i64).into()])).await.map_err(internal)?;
    let items = rows.iter().map(|row| Entry::from_query_result(row, "").map(|entry| entry.value())).collect::<Result<Vec<_>,_>>().map_err(internal)?;
    Ok(Json(json!({"items":items,"total":total})))
}

pub async fn stats(State(state): State<AppState>) -> ApiResult {
    let backend = state.db.get_database_backend();
    let integer_type = if backend == DbBackend::MySql { "SIGNED" } else { "BIGINT" };
    let sql = format!("SELECT COUNT(*) AS entries, CAST(COALESCE(SUM(comment_count),0) AS {integer_type}) AS comments, CAST(COALESCE(SUM(size_bytes),0) AS {integer_type}) AS bytes FROM ({}) entries",projection(backend));
    let row = state.db.query_one(Statement::from_string(backend,sql)).await.map_err(internal)?.ok_or_else(|| internal("缺少统计结果"))?;
    let count: i64 = row.try_get("","entries").map_err(internal)?;
    let comments: i64 = row.try_get("","comments").map_err(internal)?;
    let bytes: i64 = row.try_get("","bytes").map_err(internal)?;
    Ok(Json(json!({"data":{"file_count":count,"total_size_bytes":bytes,"total_comments":comments,
        "usage_ratio":null,"max_bytes":null,"unlimited":null,"dir":null,"r2_control":null,"r2_task":null,
        "capabilities":{"quota":false,"cleanup":false,"clear_all":false,"r2":false,"delete_normalized":true,"delete_legacy":false},
        "storage_note":"集数为规范化响应分组与旧归档之和；多请求变体分别计数弹幕。大小仅为旧归档元数据字节，不含数据库物理大小；未实现容量配额。"}})))
}

#[derive(Deserialize)]
pub struct PreviewQuery {
    #[serde(default)] offset: u64,
    #[serde(default = "preview_limit")] limit: u64,
}
fn preview_limit() -> u64 { 100 }
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 512 && !id.chars().any(|c| c.is_control() || c == '/' || c == '\\') && id != "all"
}
fn response_filter(id: &str) -> sea_orm::Condition {
    if let Some(key) = id.strip_prefix("extcomment:") {
        sea_orm::Condition::all().add(response::Column::ApiPath.eq("extcomment")).add(response::Column::RequestKey.eq(key))
    } else {
        sea_orm::Condition::all().add(response::Column::ApiPath.eq(format!("comment/{id}")))
    }
}

pub async fn detail(State(state): State<AppState>, Path(id): Path<String>, Query(query): Query<PreviewQuery>) -> ApiResult {
    if !valid_id(&id) || !(1..=500).contains(&query.limit) || query.offset > i64::MAX as u64 {
        return Err(error(StatusCode::BAD_REQUEST,"invalid_query","条目标识或预览分页无效，limit 为 1 到 500"));
    }
    let backend = state.db.get_database_backend();
    let sql = format!("SELECT * FROM ({}) entries WHERE id = {}",projection(backend),placeholder(backend,1));
    let row = state.db.query_one(Statement::from_sql_and_values(backend,sql,[id.clone().into()])).await.map_err(internal)?.ok_or_else(|| error(StatusCode::NOT_FOUND,"not_found","弹幕条目不存在"))?;
    let entry = Entry::from_query_result(&row, "").map_err(internal)?;
    let mut value = entry.value();
    // 不读取任意旧 file_path：旧归档仅展示元数据，避免把旧 JSON 再次变为公共业务源。
    value["file_exists"] = Value::Null;
    value["preview_available"] = json!(entry.storage_kind == "normalized");
    value["preview_total"] = json!(entry.comment_count);
    value["preview"] = json!([]);
    value["has_more"] = json!(false);
    if entry.storage_kind == "normalized" {
        // 在同一快照内获取所有 query 变体的键和预览，保留 request_key 以免混淆响应。
        let txn = state.db.begin().await.map_err(internal)?;
        let keys: Vec<String> = response::Entity::find().filter(response_filter(&id)).all(&txn).await.map_err(internal)?.into_iter().map(|row|row.request_key).collect();
        let selector = comment::Entity::find().filter(comment::Column::RequestKey.is_in(keys));
        let total = selector.clone().count(&txn).await.map_err(internal)?;
        let rows = selector.order_by_asc(comment::Column::RequestKey).order_by_asc(comment::Column::Ordinal).offset(query.offset).limit(query.limit).all(&txn).await.map_err(internal)?;
        let preview = rows.iter().map(|row| {
            let mut item = json!({"request_key":row.request_key,"ordinal":row.ordinal});
            if row.present_fields & 1 != 0 { item["cid"] = json!(row.cid); }
            if row.present_fields & 2 != 0 {
                item["p"] = if row.p_is_null { Value::Null } else {
                    match (row.time_seconds,row.mode,row.color,row.user_id.as_deref()) {
                        (Some(time),Some(mode),Some(color),Some(user)) => json!(format!("{time},{mode},{color},{user}")),
                        _ => Value::Null,
                    }
                };
            }
            if row.present_fields & 4 != 0 { item["m"] = json!(row.m); }
            item
        }).collect::<Vec<_>>();
        value["preview_total"] = json!(total);
        value["has_more"] = json!(query.offset.saturating_add(preview.len() as u64) < total);
        value["preview"] = json!(preview);
        txn.commit().await.map_err(internal)?;
    }
    Ok(Json(json!({"data":value})))
}

pub async fn delete_entry(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult {
    if !valid_id(&id) { return Err(error(StatusCode::BAD_REQUEST,"invalid_id","条目标识无效")); }
    // 旧文件的生命周期未实现安全事务协议，明确拒绝而不是部分删除。
    if id.starts_with("legacy:") { return Err(error(StatusCode::NOT_IMPLEMENTED,"legacy_delete_unsupported","旧文件与数据库元数据无法保证原子删除，当前仅允许只读管理")); }
    let txn = state.db.begin().await.map_err(internal)?;
    // 相同 episode_id 的旧归档仍可能存在，不能声称它也已删除。
    let keys: Vec<String> = response::Entity::find().filter(response_filter(&id)).all(&txn).await.map_err(internal)?.into_iter().map(|row|row.request_key).collect();
    if keys.is_empty() {
        let has_legacy = legacy::Entity::find().filter(legacy::Column::EpisodeId.eq(&id)).one(&txn).await.map_err(internal)?.is_some();
        return Err(if has_legacy { error(StatusCode::NOT_IMPLEMENTED,"legacy_delete_unsupported","仅存在旧文件归档，当前不支持安全删除") } else { error(StatusCode::NOT_FOUND,"not_found","弹幕条目不存在") });
    }
    let deleted = comment::Entity::delete_many().filter(comment::Column::RequestKey.is_in(keys.clone())).exec(&txn).await.map_err(internal)?.rows_affected;
    let variants = response::Entity::delete_many().filter(response::Column::RequestKey.is_in(keys)).exec(&txn).await.map_err(internal)?.rows_affected;
    txn.commit().await.map_err(internal)?;
    tracing::info!(variants, deleted, "已事务删除规范化弹幕条目，未改动旧文件归档");
    Ok(Json(json!({"success":true,"message":"已删除规范化弹幕响应；独立旧文件归档未改动","data":{"deleted_comments":deleted,"deleted_variants":variants}})))
}
