use axum::{
    extract::{State, Json, Path, Query},
    http::StatusCode,
};
use db::{entities::*, AnimeRepo, EpisodeRepo};
use sea_orm::{EntityTrait, QueryFilter, ColumnTrait, QueryOrder, PaginatorTrait};
use crate::AppState;
use super::super::users::PaginationQuery;
use super::models::*;

/// 获取番剧列表
pub async fn get_animes(
    State(state): State<AppState>,
    Query(query): Query<PaginationQuery>,
) -> Result<Json<AnimeListResponse>, (StatusCode, String)> {
    let page = query.page.max(1);
    let page_size = query.page_size.min(100).max(1);
    let offset = (page - 1) * page_size;
    
    let animes = anime::Entity::find()
        .order_by_desc(anime::Column::CreatedAt)
        .offset(offset)
        .limit(page_size)
        .all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let total = anime::Entity::find()
        .count(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let anime_infos: Vec<AnimeInfo> = animes.into_iter().map(|a| AnimeInfo {
        id: a.id,
        upstream_anime_id: a.upstream_anime_id,
        title: a.title,
        title_en: a.title_en,
        year: a.year,
        season: a.season,
        status: a.status,
        cover_url: a.cover_url,
        total_episodes: a.total_episodes,
        created_at: a.created_at.to_rfc3339(),
        updated_at: a.updated_at.to_rfc3339(),
    }).collect();
    
    Ok(Json(AnimeListResponse {
        animes: anime_infos,
        total,
        page,
        page_size,
    }))
}

/// 获取番剧详情
pub async fn get_anime(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<AnimeDetailResponse>, (StatusCode, String)> {
    let anime = anime::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Anime not found".to_string()))?;
    
    // 获取该番剧的所有剧集
    let episodes = episode::Entity::find()
        .filter(episode::Column::AnimeId.eq(id))
        .order_by_asc(episode::Column::EpisodeNumber)
        .all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let anime_info = AnimeInfo {
        id: anime.id,
        upstream_anime_id: anime.upstream_anime_id,
        title: anime.title,
        title_en: anime.title_en,
        year: anime.year,
        season: anime.season,
        status: anime.status,
        cover_url: anime.cover_url,
        total_episodes: anime.total_episodes,
        created_at: anime.created_at.to_rfc3339(),
        updated_at: anime.updated_at.to_rfc3339(),
    };
    
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
    
    let total_episodes = episode_infos.len();
    
    Ok(Json(AnimeDetailResponse {
        anime: anime_info,
        episodes: episode_infos,
        total_episodes,
    }))
}

/// 搜索番剧
pub async fn search_animes(
    State(state): State<AppState>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<AnimeListResponse>, (StatusCode, String)> {
    let page = query.page.max(1);
    let page_size = query.page_size.min(100).max(1);
    let offset = (page - 1) * page_size;
    
    let search_term = format!("%{}%", query.q);
    
    let animes = anime::Entity::find()
        .filter(
            anime::Column::Title.like(&search_term)
                .or(anime::Column::TitleEn.like(&search_term))
        )
        .order_by_desc(anime::Column::CreatedAt)
        .offset(offset)
        .limit(page_size)
        .all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let total = anime::Entity::find()
        .filter(
            anime::Column::Title.like(&search_term)
                .or(anime::Column::TitleEn.like(&search_term))
        )
        .count(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let anime_infos: Vec<AnimeInfo> = animes.into_iter().map(|a| AnimeInfo {
        id: a.id,
        upstream_anime_id: a.upstream_anime_id,
        title: a.title,
        title_en: a.title_en,
        year: a.year,
        season: a.season,
        status: a.status,
        cover_url: a.cover_url,
        total_episodes: a.total_episodes,
        created_at: a.created_at.to_rfc3339(),
        updated_at: a.updated_at.to_rfc3339(),
    }).collect();
    
    Ok(Json(AnimeListResponse {
        animes: anime_infos,
        total,
        page,
        page_size,
    }))
}

/// 创建番剧
pub async fn create_anime(
    State(state): State<AppState>,
    Json(req): Json<CreateAnimeRequest>,
) -> Result<Json<AnimeInfo>, (StatusCode, String)> {
    let anime = AnimeRepo::create(
        &state.db,
        req.upstream_anime_id,
        req.title,
        req.title_en,
        req.year,
        req.season,
        req.status,
        req.cover_url,
        req.total_episodes,
    )
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let anime_info = AnimeInfo {
        id: anime.id,
        upstream_anime_id: anime.upstream_anime_id,
        title: anime.title,
        title_en: anime.title_en,
        year: anime.year,
        season: anime.season,
        status: anime.status,
        cover_url: anime.cover_url,
        total_episodes: anime.total_episodes,
        created_at: anime.created_at.to_rfc3339(),
        updated_at: anime.updated_at.to_rfc3339(),
    };
    
    Ok(Json(anime_info))
}

/// 更新番剧
pub async fn update_anime(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(req): Json<UpdateAnimeRequest>,
) -> Result<Json<AnimeInfo>, (StatusCode, String)> {
    let anime = anime::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Anime not found".to_string()))?;
    
    let mut active: anime::ActiveModel = anime.into();
    
    if let Some(title) = req.title {
        active.title = sea_orm::Set(title);
    }
    if let Some(title_en) = req.title_en {
        active.title_en = sea_orm::Set(Some(title_en));
    }
    if let Some(year) = req.year {
        active.year = sea_orm::Set(Some(year));
    }
    if let Some(season) = req.season {
        active.season = sea_orm::Set(Some(season));
    }
    if let Some(status) = req.status {
        active.status = sea_orm::Set(Some(status));
    }
    if let Some(cover_url) = req.cover_url {
        active.cover_url = sea_orm::Set(Some(cover_url));
    }
    if let Some(total_episodes) = req.total_episodes {
        active.total_episodes = sea_orm::Set(Some(total_episodes));
    }
    active.updated_at = sea_orm::Set(chrono::Utc::now());
    
    let updated = active.update(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let anime_info = AnimeInfo {
        id: updated.id,
        upstream_anime_id: updated.upstream_anime_id,
        title: updated.title,
        title_en: updated.title_en,
        year: updated.year,
        season: updated.season,
        status: updated.status,
        cover_url: updated.cover_url,
        total_episodes: updated.total_episodes,
        created_at: updated.created_at.to_rfc3339(),
        updated_at: updated.updated_at.to_rfc3339(),
    };
    
    Ok(Json(anime_info))
}

/// 删除番剧
pub async fn delete_anime(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, (StatusCode, String)> {
    anime::Entity::delete_by_id(id)
        .exec(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_search_query() {
        let query = SearchQuery {
            q: "test".to_string(),
            page: 1,
            page_size: 20,
        };
        assert_eq!(query.q, "test");
    }
}
