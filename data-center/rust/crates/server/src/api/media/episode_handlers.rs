use axum::{
    extract::{State, Json, Path, Query},
    http::StatusCode,
};
use db::{entities::*, EpisodeRepo};
use sea_orm::{EntityTrait, QueryFilter, ColumnTrait, QueryOrder, PaginatorTrait};
use crate::AppState;
use super::super::users::PaginationQuery;
use super::models::*;

/// 获取剧集列表
pub async fn get_episodes(
    State(state): State<AppState>,
    Query(query): Query<PaginationQuery>,
) -> Result<Json<EpisodeListResponse>, (StatusCode, String)> {
    let page = query.page.max(1);
    let page_size = query.page_size.min(100).max(1);
    let offset = (page - 1) * page_size;
    
    let episodes = episode::Entity::find()
        .order_by_desc(episode::Column::CreatedAt)
        .offset(offset)
        .limit(page_size)
        .all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let total = episode::Entity::find()
        .count(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let episode_infos: Vec<EpisodeInfo> = episodes.into_iter().map(|e| EpisodeInfo {
        id: e.id,
        upstream_episode_id: e.upstream_episode_id,
        anime_id: e.anime_id,
        episode_number: e.episode_number,
        title: e.title,
        title_zh: e.title_zh,
        airdate: e.airdate.map(|d| d.to_string()),
        created_at: e.created_at.to_rfc3339(),
        updated_at: e.updated_at.to_rfc3339(),
    }).collect();
    
    Ok(Json(EpisodeListResponse {
        episodes: episode_infos,
        total,
        page,
        page_size,
    }))
}

/// 获取剧集详情
pub async fn get_episode(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<EpisodeInfo>, (StatusCode, String)> {
    let episode = episode::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Episode not found".to_string()))?;
    
    let episode_info = EpisodeInfo {
        id: episode.id,
        upstream_episode_id: episode.upstream_episode_id,
        anime_id: episode.anime_id,
        episode_number: episode.episode_number,
        title: episode.title,
        title_zh: episode.title_zh,
        airdate: episode.airdate.map(|d| d.to_string()),
        created_at: episode.created_at.to_rfc3339(),
        updated_at: episode.updated_at.to_rfc3339(),
    };
    
    Ok(Json(episode_info))
}

/// 获取番剧的所有剧集
#[derive(serde::Deserialize)]
pub struct AnimeEpisodesQuery {
    pub anime_id: i64,
}

pub async fn get_anime_episodes(
    State(state): State<AppState>,
    Query(query): Query<AnimeEpisodesQuery>,
) -> Result<Json<EpisodeListResponse>, (StatusCode, String)> {
    let episodes = episode::Entity::find()
        .filter(episode::Column::AnimeId.eq(query.anime_id))
        .order_by_asc(episode::Column::EpisodeNumber)
        .all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let total = episodes.len() as u64;
    
    let episode_infos: Vec<EpisodeInfo> = episodes.into_iter().map(|e| EpisodeInfo {
        id: e.id,
        upstream_episode_id: e.upstream_episode_id,
        anime_id: e.anime_id,
        episode_number: e.episode_number,
        title: e.title,
        title_zh: e.title_zh,
        airdate: e.airdate.map(|d| d.to_string()),
        created_at: e.created_at.to_rfc3339(),
        updated_at: e.updated_at.to_rfc3339(),
    }).collect();
    
    Ok(Json(EpisodeListResponse {
        episodes: episode_infos,
        total,
        page: 1,
        page_size: total,
    }))
}

/// 创建剧集
pub async fn create_episode(
    State(state): State<AppState>,
    Json(req): Json<CreateEpisodeRequest>,
) -> Result<Json<EpisodeInfo>, (StatusCode, String)> {
    let airdate = req.airdate.as_ref().and_then(|s| {
        chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
    });
    
    let episode = EpisodeRepo::create(
        &state.db,
        req.upstream_episode_id,
        req.anime_id,
        req.episode_number,
        req.title,
        req.title_zh,
        airdate,
    )
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let episode_info = EpisodeInfo {
        id: episode.id,
        upstream_episode_id: episode.upstream_episode_id,
        anime_id: episode.anime_id,
        episode_number: episode.episode_number,
        title: episode.title,
        title_zh: episode.title_zh,
        airdate: episode.airdate.map(|d| d.to_string()),
        created_at: episode.created_at.to_rfc3339(),
        updated_at: episode.updated_at.to_rfc3339(),
    };
    
    Ok(Json(episode_info))
}

/// 更新剧集
pub async fn update_episode(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<UpdateEpisodeRequest>,
) -> Result<Json<EpisodeInfo>, (StatusCode, String)> {
    let episode = episode::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Episode not found".to_string()))?;
    
    let mut active: episode::ActiveModel = episode.into();
    
    if let Some(episode_number) = req.episode_number {
        active.episode_number = sea_orm::Set(episode_number);
    }
    if let Some(title) = req.title {
        active.title = sea_orm::Set(Some(title));
    }
    if let Some(title_zh) = req.title_zh {
        active.title_zh = sea_orm::Set(Some(title_zh));
    }
    if let Some(airdate_str) = req.airdate {
        let airdate = chrono::NaiveDate::parse_from_str(&airdate_str, "%Y-%m-%d")
            .map_err(|_| (StatusCode::BAD_REQUEST, "Invalid date format".to_string()))?;
        active.airdate = sea_orm::Set(Some(airdate));
    }
    active.updated_at = sea_orm::Set(chrono::Utc::now());
    
    let updated = active.update(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let episode_info = EpisodeInfo {
        id: updated.id,
        upstream_episode_id: updated.upstream_episode_id,
        anime_id: updated.anime_id,
        episode_number: updated.episode_number,
        title: updated.title,
        title_zh: updated.title_zh,
        airdate: updated.airdate.map(|d| d.to_string()),
        created_at: updated.created_at.to_rfc3339(),
        updated_at: updated.updated_at.to_rfc3339(),
    };
    
    Ok(Json(episode_info))
}

/// 删除剧集
pub async fn delete_episode(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, (StatusCode, String)> {
    episode::Entity::delete_by_id(id)
        .exec(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_anime_episodes_query() {
        let query = AnimeEpisodesQuery { anime_id: 1 };
        assert_eq!(query.anime_id, 1);
    }
}
