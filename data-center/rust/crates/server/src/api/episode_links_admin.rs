//! 人工分集映射管理；字段仅来自真实 episode_links 表，不混用 episodes 主键。
use axum::{extract::{Path, Query, State}, http::StatusCode, routing::{get, put}, Json, Router};
use db::entities::episode_link::{self as link, Column, Entity, Model};
use sea_orm::{ActiveModelTrait, ColumnTrait, Condition, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Set};
use serde::Deserialize;
use serde_json::{json, Value};
use crate::AppState;

type ApiError = (StatusCode, Json<Value>);
type ApiResult = Result<Json<Value>, ApiError>;

/// 必须由上层挂入 JWT + 管理员鉴权分组，不能作为公开写入接口。
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/episodes/links/stats", get(stats))
        .route("/episodes/links", get(list).post(create))
        .route("/episodes/links/{id}", put(update))
}
fn error(status: StatusCode, message: &str) -> ApiError {
    (status, Json(json!({"message":message})))
}
fn db_error(err: sea_orm::DbErr) -> ApiError {
    tracing::error!(error = %err, "分集映射管理数据库操作失败");
    error(StatusCode::INTERNAL_SERVER_ERROR, "分集映射数据库操作失败")
}
fn fields(row: &Model) -> Value {
    json!({"id":row.id,"local_title":row.local_title,"season_number":row.season_number,
        "episode_number":row.episode_number,"episode_title":row.episode_title,
        "dandan_episode_id":row.dandan_episode_id,"anime_title":row.anime_title,
        "match_source":row.match_source,"confidence":row.confidence,"is_manual":row.is_manual,
        "source_cache_key":row.source_cache_key,"last_used_at":row.last_used_at,
        "created_at":row.created_at,"updated_at":row.updated_at})
}
async fn stats(State(state): State<AppState>) -> ApiResult {
    let total = Entity::find().count(&state.db).await.map_err(db_error)?;
    let manual = Entity::find().filter(Column::IsManual.eq(true)).count(&state.db).await.map_err(db_error)?;
    // SQL 分组统计全表，不能先取固定数量记录再算统计。
    let groups = Entity::find().select_only().column(Column::MatchSource)
        .column_as(Column::Id.count(), "count").group_by(Column::MatchSource)
        .into_tuple::<(String, i64)>().all(&state.db).await.map_err(db_error)?;
    let sources: serde_json::Map<String, Value> = groups.into_iter().map(|(source, count)| (source, json!(count))).collect();
    Ok(Json(json!({"data":{"total":total,"manual":manual,"sources":sources}})))
}
#[derive(Deserialize)]
struct ListQuery {
    page: Option<u64>, page_size: Option<u64>, keyword: Option<String>,
    episode_id: Option<String>, match_source: Option<String>,
}
async fn list(State(state): State<AppState>, Query(q): Query<ListQuery>) -> ApiResult {
    let page = q.page.unwrap_or(1);
    let size = q.page_size.unwrap_or(20);
    if page == 0 || size == 0 || size > 200 || (page - 1).checked_mul(size).is_none_or(|v| v > i64::MAX as u64) {
        return Err(error(StatusCode::BAD_REQUEST, "page 必须为正整数，page_size 范围为 1..200，分页偏移不可溢出"));
    }
    let mut select = Entity::find();
    if let Some(keyword) = q.keyword.filter(|s| !s.is_empty()) {
        select = select.filter(Condition::any().add(Column::LocalTitle.contains(&keyword))
            .add(Column::AnimeTitle.contains(&keyword)).add(Column::EpisodeTitle.contains(&keyword))
            .add(Column::DandanEpisodeId.contains(&keyword)));
    }
    // episode_id 是上游 ID，绝非 episode_links.id 或 episodes.id。
    if let Some(id) = q.episode_id.filter(|s| !s.is_empty()) { select = select.filter(Column::DandanEpisodeId.eq(id)); }
    if let Some(source) = q.match_source.filter(|s| !s.is_empty()) { select = select.filter(Column::MatchSource.eq(source)); }
    let total = select.clone().count(&state.db).await.map_err(db_error)?;
    let rows = select.order_by_desc(Column::Id).offset((page - 1) * size).limit(size).all(&state.db).await.map_err(db_error)?;
    Ok(Json(json!({"items":rows.iter().map(fields).collect::<Vec<_>>(),"total":total})))
}
fn validate_target(id: &str, confidence: i32) -> Result<(), ApiError> {
    if id.trim().is_empty() { return Err(error(StatusCode::BAD_REQUEST, "dandan_episode_id 不得为空")); }
    if !(0..=100).contains(&confidence) { return Err(error(StatusCode::BAD_REQUEST, "confidence 范围为 0..100 的整数")); }
    Ok(())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateBody {
    local_title: String, dandan_episode_id: String, episode_title: Option<String>,
    anime_title: Option<String>, season_number: Option<i32>, episode_number: Option<String>,
    confidence: i32, match_source: String, source_cache_key: String,
}
async fn create(State(state): State<AppState>, Json(body): Json<CreateBody>) -> ApiResult {
    validate_target(&body.dandan_episode_id, body.confidence)?;
    if body.local_title.trim().is_empty() || body.source_cache_key.trim().is_empty() {
        return Err(error(StatusCode::BAD_REQUEST, "local_title 与 source_cache_key 不得为空"));
    }
    if body.match_source != "manual" || body.season_number.is_some_and(|n| n < 0) {
        return Err(error(StatusCode::BAD_REQUEST, "人工创建 match_source 必须为 manual，season_number 不得为负数"));
    }
    let now = chrono::Utc::now().naive_utc();
    let eid = body.dandan_episode_id.trim().to_owned();
    // 不从上游集 ID 猜测番剧 ID，也不伪造上游实体；可创建尚未摄取的手工映射。
    let row = link::ActiveModel {
        local_title: Set(body.local_title), dandan_episode_id: Set(eid.clone()),
        episode_title: Set(body.episode_title), anime_title: Set(body.anime_title),
        season_number: Set(body.season_number), episode_number: Set(body.episode_number),
        confidence: Set(body.confidence), match_source: Set("manual".into()), is_manual: Set(true),
        source_cache_key: Set(body.source_cache_key),
        comment_api_path: Set(Some(format!("/api/v2/comment/{eid}"))),
        comment_cache_key: Set(Some(format!("comment/{eid}"))),
        created_at: Set(now), updated_at: Set(now), ..Default::default()
    }.insert(&state.db).await.map_err(db_error)?;
    Ok(Json(json!({"data":fields(&row)})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateBody { dandan_episode_id: String, episode_title: Option<String>, confidence: i32 }
async fn update(State(state): State<AppState>, Path(id): Path<i64>, Json(body): Json<UpdateBody>) -> ApiResult {
    if id <= 0 { return Err(error(StatusCode::BAD_REQUEST, "映射主键必须为正整数")); }
    validate_target(&body.dandan_episode_id, body.confidence)?;
    let row = Entity::find_by_id(id).one(&state.db).await.map_err(db_error)?
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "分集映射不存在"))?;
    let eid = body.dandan_episode_id.trim().to_owned();
    let changed_target = row.dandan_episode_id != eid;
    let mut active: link::ActiveModel = row.into();
    // 换目标后旧番剧/缓存关联不再可信，不能将旧上游属性带到新分集。
    if changed_target {
        active.dandan_anime_id = Set(None);
        active.dandan_bangumi_id = Set(None);
        active.bangumi_cache_key = Set(None);
        active.anime_title = Set(None);
        active.last_used_at = Set(None);
    }
    active.dandan_episode_id = Set(eid.clone());
    active.episode_title = Set(body.episode_title);
    active.confidence = Set(body.confidence);
    active.match_source = Set("manual".into());
    active.is_manual = Set(true);
    active.source_cache_key = Set(format!("manual:{eid}"));
    active.comment_api_path = Set(Some(format!("/api/v2/comment/{eid}")));
    active.comment_cache_key = Set(Some(format!("comment/{eid}")));
    active.updated_at = Set(chrono::Utc::now().naive_utc());
    let row = active.update(&state.db).await.map_err(db_error)?;
    Ok(Json(json!({"data":fields(&row)})))
}
