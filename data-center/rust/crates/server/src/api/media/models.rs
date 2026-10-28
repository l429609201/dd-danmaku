use serde::{Deserialize, Serialize};

/// 番剧信息（字段与 animes 表实体保持一致）
#[derive(Debug, Serialize, Clone)]
pub struct AnimeInfo {
    pub id: i64,
    pub upstream_anime_id: String,
    pub title: Option<String>,
    pub image_url: Option<String>,
    pub type_code: Option<String>,
    pub type_description: Option<String>,
    pub summary: Option<String>,
    pub rating: Option<String>,
    pub start_date: Option<String>,
    pub episode_count: i32,
    pub source: String,
    pub created_at: String,
    pub updated_at: String,
}

impl From<db::entities::anime::Model> for AnimeInfo {
    fn from(a: db::entities::anime::Model) -> Self {
        Self {
            id: a.id,
            upstream_anime_id: a.upstream_anime_id,
            title: a.title,
            image_url: a.image_url,
            type_code: a.type_code,
            type_description: a.type_description,
            summary: a.summary,
            rating: a.rating,
            start_date: a.start_date,
            episode_count: a.episode_count,
            source: a.source,
            created_at: a.created_at.and_utc().to_rfc3339(),
            updated_at: a.updated_at.and_utc().to_rfc3339(),
        }
    }
}

/// 剧集信息（字段与 episodes 表实体保持一致）
#[derive(Debug, Serialize, Clone)]
pub struct EpisodeInfo {
    pub id: i64,
    pub anime_id: i64,
    pub season_id: Option<i64>,
    pub upstream_episode_id: String,
    pub episode_number: Option<String>,
    pub title: Option<String>,
    pub type_description: Option<String>,
    pub duration_seconds: Option<i32>,
    pub air_date: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl From<db::entities::episode::Model> for EpisodeInfo {
    fn from(e: db::entities::episode::Model) -> Self {
        Self {
            id: e.id,
            anime_id: e.anime_id,
            season_id: e.season_id,
            upstream_episode_id: e.upstream_episode_id,
            episode_number: e.episode_number,
            title: e.title,
            type_description: e.type_description,
            duration_seconds: e.duration_seconds,
            air_date: e.air_date,
            created_at: e.created_at.and_utc().to_rfc3339(),
            updated_at: e.updated_at.and_utc().to_rfc3339(),
        }
    }
}

/// 创建番剧请求
#[derive(Debug, Deserialize)]
pub struct CreateAnimeRequest {
    pub upstream_anime_id: String,
    pub title: Option<String>,
    pub image_url: Option<String>,
    pub type_code: Option<String>,
    pub type_description: Option<String>,
    pub summary: Option<String>,
    pub rating: Option<String>,
    pub start_date: Option<String>,
    #[serde(default)]
    pub episode_count: i32,
}

/// 更新番剧请求（仅更新传入的字段）
#[derive(Debug, Deserialize)]
pub struct UpdateAnimeRequest {
    pub title: Option<String>,
    pub image_url: Option<String>,
    pub type_code: Option<String>,
    pub type_description: Option<String>,
    pub summary: Option<String>,
    pub rating: Option<String>,
    pub start_date: Option<String>,
    pub episode_count: Option<i32>,
}

/// 创建剧集请求
#[derive(Debug, Deserialize)]
pub struct CreateEpisodeRequest {
    pub upstream_episode_id: String,
    pub anime_id: i64,
    pub season_id: Option<i64>,
    pub episode_number: Option<String>,
    pub title: Option<String>,
    pub type_description: Option<String>,
    pub duration_seconds: Option<i32>,
    pub air_date: Option<String>,
}

/// 更新剧集请求（仅更新传入的字段）
#[derive(Debug, Deserialize)]
pub struct UpdateEpisodeRequest {
    pub season_id: Option<i64>,
    pub episode_number: Option<String>,
    pub title: Option<String>,
    pub type_description: Option<String>,
    pub duration_seconds: Option<i32>,
    pub air_date: Option<String>,
}

/// 番剧列表响应
#[derive(Debug, Serialize)]
pub struct AnimeListResponse {
    pub animes: Vec<AnimeInfo>,
    pub total: u64,
    pub page: u64,
    pub page_size: u64,
}

/// 剧集列表响应
#[derive(Debug, Serialize)]
pub struct EpisodeListResponse {
    pub episodes: Vec<EpisodeInfo>,
    pub total: u64,
    pub page: u64,
    pub page_size: u64,
}

/// 搜索查询参数
#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: String,
    #[serde(default = "default_page")]
    pub page: u64,
    #[serde(default = "default_page_size")]
    pub page_size: u64,
}

/// 按番剧查询剧集参数
#[derive(Debug, Deserialize)]
pub struct AnimeEpisodesQuery {
    pub anime_id: i64,
}

fn default_page() -> u64 { 1 }
fn default_page_size() -> u64 { 20 }

/// 番剧详情（带剧集）
#[derive(Debug, Serialize)]
pub struct AnimeDetailResponse {
    pub anime: AnimeInfo,
    pub episodes: Vec<EpisodeInfo>,
    pub total_episodes: usize,
}
