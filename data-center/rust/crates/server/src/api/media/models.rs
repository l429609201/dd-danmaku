use serde::{Deserialize, Serialize};

/// 番剧信息
#[derive(Debug, Serialize, Clone)]
pub struct AnimeInfo {
    pub id: i64,
    pub upstream_anime_id: i64,
    pub title: String,
    pub title_en: Option<String>,
    pub year: Option<i32>,
    pub season: Option<String>,
    pub status: Option<String>,
    pub cover_url: Option<String>,
    pub total_episodes: Option<i32>,
    pub created_at: String,
    pub updated_at: String,
}

/// 剧集信息
#[derive(Debug, Serialize, Clone)]
pub struct EpisodeInfo {
    pub id: i64,
    pub upstream_episode_id: i64,
    pub anime_id: i64,
    pub episode_number: i32,
    pub title: Option<String>,
    pub title_zh: Option<String>,
    pub airdate: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// 创建番剧请求
#[derive(Debug, Deserialize)]
pub struct CreateAnimeRequest {
    pub upstream_anime_id: i64,
    pub title: String,
    pub title_en: Option<String>,
    pub year: Option<i32>,
    pub season: Option<String>,
    pub status: Option<String>,
    pub cover_url: Option<String>,
    pub total_episodes: Option<i32>,
}

/// 更新番剧请求
#[derive(Debug, Deserialize)]
pub struct UpdateAnimeRequest {
    pub title: Option<String>,
    pub title_en: Option<String>,
    pub year: Option<i32>,
    pub season: Option<String>,
    pub status: Option<String>,
    pub cover_url: Option<String>,
    pub total_episodes: Option<i32>,
}

/// 创建剧集请求
#[derive(Debug, Deserialize)]
pub struct CreateEpisodeRequest {
    pub upstream_episode_id: i64,
    pub anime_id: i64,
    pub episode_number: i32,
    pub title: Option<String>,
    pub title_zh: Option<String>,
    pub airdate: Option<String>,
}

/// 更新剧集请求
#[derive(Debug, Deserialize)]
pub struct UpdateEpisodeRequest {
    pub episode_number: Option<i32>,
    pub title: Option<String>,
    pub title_zh: Option<String>,
    pub airdate: Option<String>,
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

fn default_page() -> u64 { 1 }
fn default_page_size() -> u64 { 20 }

/// 番剧详情（带剧集）
#[derive(Debug, Serialize)]
pub struct AnimeDetailResponse {
    pub anime: AnimeInfo,
    pub episodes: Vec<EpisodeInfo>,
    pub total_episodes: usize,
}

/// 别名信息
#[derive(Debug, Serialize)]
pub struct AliasInfo {
    pub id: i64,
    pub anime_id: i64,
    pub alias: String,
    pub alias_norm: String,
    pub created_at: String,
}

/// 添加别名请求
#[derive(Debug, Deserialize)]
pub struct AddAliasRequest {
    pub alias: String,
}

/// 外部 ID 信息
#[derive(Debug, Serialize)]
pub struct ExternalIdInfo {
    pub id: i64,
    pub anime_id: i64,
    pub provider: String,
    pub external_id: String,
    pub created_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_anime_info_serialize() {
        let anime = AnimeInfo {
            id: 1,
            upstream_anime_id: 12345,
            title: "测试动漫".to_string(),
            title_en: Some("Test Anime".to_string()),
            year: Some(2024),
            season: Some("春".to_string()),
            status: Some("连载中".to_string()),
            cover_url: None,
            total_episodes: Some(12),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        };
        
        let json = serde_json::to_string(&anime).unwrap();
        assert!(json.contains("测试动漫"));
        assert!(json.contains("12345"));
    }
}
