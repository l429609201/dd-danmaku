use axum::{
    extract::{Json, Path, Query, State},
    http::StatusCode,
};
use db::entities::{anime, episode};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, Set,
};

use super::super::users::PaginationQuery;
use super::models::*;
use crate::AppState;

type ApiError = (StatusCode, String);

/// 数据库错误统一映射为 500
fn db_err(e: sea_orm::DbErr) -> ApiError {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

/// 规范分页参数：页码至少为 1，每页 1..=100
fn normalize_page(page: u64, page_size: u64) -> (u64, u64, u64) {
    let page = page.max(1);
    let page_size = page_size.clamp(1, 100);
    (page, page_size, (page - 1) * page_size)
}

/// 获取番剧列表
pub async fn get_animes(
    State(state): State<AppState>,
    Query(query): Query<PaginationQuery>,
) -> Result<Json<AnimeListResponse>, ApiError> {
    let (page, page_size, offset) = normalize_page(query.page, query.page_size);

    let animes = anime::Entity::find()
        .order_by_desc(anime::Column::CreatedAt)
        .offset(offset)
        .limit(page_size)
        .all(&state.db)
        .await
        .map_err(db_err)?;
    let total = anime::Entity::find().count(&state.db).await.map_err(db_err)?;

    Ok(Json(AnimeListResponse {
        animes: animes.into_iter().map(AnimeInfo::from).collect(),
        total,
        page,
        page_size,
    }))
}

/// 获取番剧详情（包含全部剧集）
pub async fn get_anime(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<AnimeDetailResponse>, ApiError> {
    let anime = anime::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .map_err(db_err)?
        .ok_or((StatusCode::NOT_FOUND, "番剧不存在".to_string()))?;

    let episodes = episode::Entity::find()
        .filter(episode::Column::AnimeId.eq(id))
        .order_by_asc(episode::Column::Id)
        .all(&state.db)
        .await
        .map_err(db_err)?;
    let episodes: Vec<EpisodeInfo> = episodes.into_iter().map(EpisodeInfo::from).collect();

    Ok(Json(AnimeDetailResponse {
        anime: AnimeInfo::from(anime),
        total_episodes: episodes.len(),
        episodes,
    }))
}

/// 按标题搜索番剧
pub async fn search_animes(
    State(state): State<AppState>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<AnimeListResponse>, ApiError> {
    let (page, page_size, offset) = normalize_page(query.page, query.page_size);
    let keyword = query.q.trim();
    if keyword.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "搜索关键词不能为空".to_string()));
    }

    let condition = anime::Column::Title.contains(keyword);
    let animes = anime::Entity::find()
        .filter(condition.clone())
        .order_by_desc(anime::Column::LastSeenAt)
        .offset(offset)
        .limit(page_size)
        .all(&state.db)
        .await
        .map_err(db_err)?;
    let total = anime::Entity::find()
        .filter(condition)
        .count(&state.db)
        .await
        .map_err(db_err)?;

    Ok(Json(AnimeListResponse {
        animes: animes.into_iter().map(AnimeInfo::from).collect(),
        total,
        page,
        page_size,
    }))
}

/// 创建番剧（来源标记为 manual）
pub async fn create_anime(
    State(state): State<AppState>,
    Json(req): Json<CreateAnimeRequest>,
) -> Result<Json<AnimeInfo>, ApiError> {
    if req.upstream_anime_id.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "upstream_anime_id 不能为空".to_string()));
    }
    let now = chrono::Utc::now().naive_utc();
    let model = anime::ActiveModel {
        upstream_anime_id: Set(req.upstream_anime_id),
        title: Set(req.title),
        image_url: Set(req.image_url),
        type_code: Set(req.type_code),
        type_description: Set(req.type_description),
        summary: Set(req.summary),
        rating: Set(req.rating),
        start_date: Set(req.start_date),
        episode_count: Set(req.episode_count),
        source: Set("manual".to_string()),
        first_seen_at: Set(now),
        last_seen_at: Set(now),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    };
    let saved = model.insert(&state.db).await.map_err(db_err)?;
    Ok(Json(AnimeInfo::from(saved)))
}

/// 更新番剧（只修改请求中提供的字段）
pub async fn update_anime(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<UpdateAnimeRequest>,
) -> Result<Json<AnimeInfo>, ApiError> {
    let existing = anime::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .map_err(db_err)?
        .ok_or((StatusCode::NOT_FOUND, "番剧不存在".to_string()))?;

    let mut active: anime::ActiveModel = existing.into();
    if req.title.is_some() { active.title = Set(req.title); }
    if req.image_url.is_some() { active.image_url = Set(req.image_url); }
    if req.type_code.is_some() { active.type_code = Set(req.type_code); }
    if req.type_description.is_some() { active.type_description = Set(req.type_description); }
    if req.summary.is_some() { active.summary = Set(req.summary); }
    if req.rating.is_some() { active.rating = Set(req.rating); }
    if req.start_date.is_some() { active.start_date = Set(req.start_date); }
    if let Some(count) = req.episode_count { active.episode_count = Set(count); }
    active.updated_at = Set(chrono::Utc::now().naive_utc());

    let saved = active.update(&state.db).await.map_err(db_err)?;
    Ok(Json(AnimeInfo::from(saved)))
}

/// 删除番剧
pub async fn delete_anime(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    let result = anime::Entity::delete_by_id(id).exec(&state.db).await.map_err(db_err)?;
    if result.rows_affected == 0 {
        return Err((StatusCode::NOT_FOUND, "番剧不存在".to_string()));
    }
    Ok(StatusCode::NO_CONTENT)
}
