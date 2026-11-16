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
    // 唯一键冲突是客户端重复提交，不应暴露数据库约束或返回 500。
    if matches!(e.sql_err(), Some(sea_orm::SqlErr::UniqueConstraintViolation(_))) {
        return (StatusCode::CONFLICT, "上游媒体标识已存在".to_string());
    }
    tracing::error!(error = %e, "媒体数据库操作失败");
    (StatusCode::INTERNAL_SERVER_ERROR, "媒体数据库操作失败".to_string())
}

/// 获取剧集列表
pub async fn get_episodes(
    State(state): State<AppState>,
    Query(query): Query<PaginationQuery>,
) -> Result<Json<EpisodeListResponse>, ApiError> {
    let page = query.page.max(1);
    let page_size = query.page_size.clamp(1, 100);
    // 数据库 OFFSET 为有符号整数；拒绝极端页码，避免乘法溢出。
    let offset = (page - 1).checked_mul(page_size)
        .filter(|offset| *offset <= i64::MAX as u64)
        .ok_or((StatusCode::BAD_REQUEST, "分页超出范围".to_string()))?;

    let episodes = episode::Entity::find()
        .order_by_desc(episode::Column::CreatedAt)
        .offset(offset)
        .limit(page_size)
        .all(&state.db)
        .await
        .map_err(db_err)?;
    let total = episode::Entity::find().count(&state.db).await.map_err(db_err)?;

    Ok(Json(EpisodeListResponse {
        episodes: episodes.into_iter().map(EpisodeInfo::from).collect(),
        total,
        page,
        page_size,
    }))
}

/// 获取剧集详情
pub async fn get_episode(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<EpisodeInfo>, ApiError> {
    let ep = episode::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .map_err(db_err)?
        .ok_or((StatusCode::NOT_FOUND, "剧集不存在".to_string()))?;
    Ok(Json(EpisodeInfo::from(ep)))
}

/// 获取指定番剧的全部剧集
pub async fn get_anime_episodes(
    State(state): State<AppState>,
    Query(query): Query<AnimeEpisodesQuery>,
) -> Result<Json<Vec<EpisodeInfo>>, ApiError> {
    let episodes = episode::Entity::find()
        .filter(episode::Column::AnimeId.eq(query.anime_id))
        .order_by_asc(episode::Column::Id)
        .all(&state.db)
        .await
        .map_err(db_err)?;
    Ok(Json(episodes.into_iter().map(EpisodeInfo::from).collect()))
}

/// 创建剧集（要求所属番剧存在）
pub async fn create_episode(
    State(state): State<AppState>,
    Json(req): Json<CreateEpisodeRequest>,
) -> Result<Json<EpisodeInfo>, ApiError> {
    if req.upstream_episode_id.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "upstream_episode_id 不能为空".to_string()));
    }
    // 时长不能为负数；缺失时长请省略该字段。
    if req.duration_seconds.is_some_and(|duration| duration < 0) {
        return Err((StatusCode::BAD_REQUEST, "duration_seconds 不能为负数".to_string()));
    }
    anime::Entity::find_by_id(req.anime_id)
        .one(&state.db)
        .await
        .map_err(db_err)?
        .ok_or((StatusCode::BAD_REQUEST, "所属番剧不存在".to_string()))?;

    let now = chrono::Utc::now().naive_utc();
    let model = episode::ActiveModel {
        anime_id: Set(req.anime_id),
        season_id: Set(req.season_id),
        upstream_episode_id: Set(req.upstream_episode_id),
        episode_number: Set(req.episode_number),
        title: Set(req.title),
        type_description: Set(req.type_description),
        duration_seconds: Set(req.duration_seconds),
        air_date: Set(req.air_date),
        // 手工创建的剧集没有对应的上游缓存键
        source_cache_key: Set("manual".to_string()),
        first_seen_at: Set(now),
        last_seen_at: Set(now),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    };
    let saved = model.insert(&state.db).await.map_err(db_err)?;
    Ok(Json(EpisodeInfo::from(saved)))
}

/// 更新剧集（只修改请求中提供的字段）
pub async fn update_episode(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<UpdateEpisodeRequest>,
) -> Result<Json<EpisodeInfo>, ApiError> {
    // 时长不能为负数；缺失时长请省略该字段。
    if req.duration_seconds.is_some_and(|duration| duration < 0) {
        return Err((StatusCode::BAD_REQUEST, "duration_seconds 不能为负数".to_string()));
    }
    let existing = episode::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .map_err(db_err)?
        .ok_or((StatusCode::NOT_FOUND, "剧集不存在".to_string()))?;

    let mut active: episode::ActiveModel = existing.into();
    if req.season_id.is_some() { active.season_id = Set(req.season_id); }
    if req.episode_number.is_some() { active.episode_number = Set(req.episode_number); }
    if req.title.is_some() { active.title = Set(req.title); }
    if req.type_description.is_some() { active.type_description = Set(req.type_description); }
    if req.duration_seconds.is_some() { active.duration_seconds = Set(req.duration_seconds); }
    if req.air_date.is_some() { active.air_date = Set(req.air_date); }
    active.updated_at = Set(chrono::Utc::now().naive_utc());

    let saved = active.update(&state.db).await.map_err(db_err)?;
    Ok(Json(EpisodeInfo::from(saved)))
}

/// 删除剧集
pub async fn delete_episode(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    let result = episode::Entity::delete_by_id(id).exec(&state.db).await.map_err(db_err)?;
    if result.rows_affected == 0 {
        return Err((StatusCode::NOT_FOUND, "剧集不存在".to_string()));
    }
    Ok(StatusCode::NO_CONTENT)
}
