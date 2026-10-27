//! 将缓存的 dandanplay 原始 JSON 响应投影为可测试的领域记录。
//!
//! 本模块不访问数据库，也不做 episodeId 算术反推；持久化层可消费结构化结果，
//! 并继续在原始响应缓存中保留完整响应以保证兼容与追溯。

use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AnimeRecord {
    pub upstream_anime_id: String,
    pub title: Option<String>,
    pub image_url: Option<String>,
    pub type_code: Option<String>,
    pub type_description: Option<String>,
    pub summary: Option<String>,
    pub rating: Option<String>,
    pub start_date: Option<String>,
    pub episode_count: Option<i32>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SeasonRecord {
    pub upstream_bangumi_id: Option<String>,
    pub title: Option<String>,
    pub summary: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EpisodeRecord {
    pub upstream_episode_id: String,
    pub upstream_anime_id: String,
    pub upstream_bangumi_id: Option<String>,
    pub episode_number: Option<String>,
    pub title: Option<String>,
    pub type_description: Option<String>,
    pub duration_seconds: Option<i32>,
    pub air_date: Option<String>,
    /// 保留完整单集片段，供迁移层落入原始响应/实体追溯层。
    pub raw: Value,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ExternalIdRecord {
    pub provider: String,
    pub external_id: Option<String>,
    pub external_url: String,
    pub confidence: i32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AliasRecord {
    pub alias: String,
    pub language: Option<String>,
    pub title_type: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ResponseProjection {
    pub animes: Vec<AnimeRecord>,
    pub seasons: Vec<SeasonRecord>,
    pub episodes: Vec<EpisodeRecord>,
    pub external_ids: Vec<ExternalIdRecord>,
    pub aliases: Vec<AliasRecord>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProjectionError {
    InvalidJson,
}

impl std::fmt::Display for ProjectionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidJson => f.write_str("响应 JSON 格式无效"),
        }
    }
}

impl std::error::Error for ProjectionError {}

/// 解析 SearchAnime/SearchEpisodes/Bangumi 响应。错误不包含响应正文，避免敏感信息外泄。
pub fn project_response(api_path: &str, body: &str) -> Result<ResponseProjection, ProjectionError> {
    let root: Value = serde_json::from_str(body).map_err(|_| ProjectionError::InvalidJson)?;
    let mut result = ResponseProjection::default();

    if api_path.contains("/search/anime") || api_path.contains("/search/episodes") {
        if let Some(animes) = root.get("animes").and_then(Value::as_array) {
            for anime in animes {
                let anime_id = first_text(anime, &["animeId", "bangumiId"]);
                let Some(anime_id) = anime_id else { continue };
                result.animes.push(project_anime(anime, anime_id.clone()));
                append_episodes(&mut result.episodes, anime, &anime_id, None);
            }
        }
    } else if api_path.contains("/bangumi/") {
        let bangumi = root.get("bangumi").unwrap_or(&root);
        let anime_id = first_text(bangumi, &["animeId"]);
        if let Some(anime_id) = anime_id {
            result.animes.push(project_anime(bangumi, anime_id.clone()));
            let bangumi_id = first_text(bangumi, &["bangumiId"])
                .or_else(|| path_tail_id(api_path));
            result.seasons.push(SeasonRecord {
                upstream_bangumi_id: bangumi_id.clone(),
                title: first_text(bangumi, &["bangumiTitle", "title", "animeTitle"]),
                summary: first_text(bangumi, &["summary"]),
            });
            append_episodes(&mut result.episodes, bangumi, &anime_id, bangumi_id);
            result.external_ids = project_external_ids(bangumi);
            result.aliases = project_aliases(bangumi);
        }
    }
    Ok(result)
}

fn project_anime(raw: &Value, id: String) -> AnimeRecord {
    let episode_count = raw
        .get("episodeCount")
        .and_then(value_i32)
        .or_else(|| raw.get("episodes").and_then(Value::as_array).map(|items| items.len() as i32));
    AnimeRecord {
        upstream_anime_id: id,
        title: first_text(raw, &["animeTitle", "title"]),
        image_url: first_text(raw, &["imageUrl"]),
        type_code: first_text(raw, &["type"]),
        type_description: first_text(raw, &["typeDescription"]),
        summary: first_text(raw, &["summary"]),
        rating: first_text(raw, &["rating"]),
        start_date: first_text(raw, &["startDate", "airDate"]),
        episode_count,
    }
}

fn append_episodes(
    destination: &mut Vec<EpisodeRecord>,
    parent: &Value,
    anime_id: &str,
    bangumi_id: Option<String>,
) {
    let Some(episodes) = parent.get("episodes").and_then(Value::as_array) else { return };
    for episode in episodes {
        let Some(episode_id) = first_text(episode, &["episodeId"]) else { continue };
        let episode_number = first_text(episode, &["episodeNumber", "episodeIndex", "episodeNo"])
            .or_else(|| episode_id_suffix(anime_id, &episode_id));
        destination.push(EpisodeRecord {
            upstream_episode_id: episode_id,
            upstream_anime_id: anime_id.to_owned(),
            upstream_bangumi_id: bangumi_id.clone(),
            episode_number,
            title: first_text(episode, &["episodeTitle"]),
            type_description: first_text(episode, &["typeDescription"]),
            duration_seconds: episode.get("duration").and_then(value_i32),
            air_date: first_text(episode, &["airDate", "startDate"]),
            raw: episode.clone(),
        });
    }
}

fn project_external_ids(raw: &Value) -> Vec<ExternalIdRecord> {
    let mut records = Vec::new();
    let mut seen = BTreeSet::new();
    if let Some(items) = raw.get("onlineDatabases").and_then(Value::as_array) {
        for item in items {
            let url = first_text(item, &["url"]);
            let Some(url) = url else { continue };
            let name = first_text(item, &["name"]).unwrap_or_default();
            let (provider, external_id) = provider_and_id(&name, &url);
            if provider.is_empty() || !seen.insert(provider.clone()) { continue; }
            records.push(ExternalIdRecord {
                confidence: if external_id.is_some() { 95 } else { 70 },
                provider,
                external_id,
                external_url: url.chars().take(500).collect(),
            });
        }
    }
    if !seen.contains("bangumi_tv") {
        if let Some(url) = first_text(raw, &["bangumiUrl"]) {
            if let Some(id) = extract_after_marker(&url, "bangumi.tv/subject/") {
                records.push(ExternalIdRecord {
                    provider: "bangumi_tv".into(),
                    external_id: Some(id),
                    external_url: url.chars().take(500).collect(),
                    confidence: 95,
                });
            }
        }
    }
    records
}

fn provider_and_id(name: &str, url: &str) -> (String, Option<String>) {
    let lower = url.to_ascii_lowercase();
    let known = [
        ("bangumi.tv/subject/", "bangumi_tv"),
        ("anidb.net/anime/", "anidb"),
        ("myanimelist.net/anime/", "mal"),
        ("myanimelist.net/manga/", "mal"),
        ("themoviedb.org/tv/", "tmdb"),
        ("themoviedb.org/movie/", "tmdb"),
        ("imdb.com/title/", "imdb"),
        ("thetvdb.com/series/", "tvdb"),
        ("anilist.co/anime/", "anilist"),
    ];
    for (marker, provider) in known {
        if let Some(id) = extract_after_marker(&lower, marker) {
            return (provider.into(), Some(id));
        }
    }
    let normalized_name = name.trim().to_ascii_lowercase();
    if !normalized_name.is_empty() {
        let key = normalized_name
            .chars()
            .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
            .collect::<String>()
            .split('_')
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join("_");
        return (key, None);
    }
    (String::new(), None)
}

fn extract_after_marker(value: &str, marker: &str) -> Option<String> {
    let lower = value.to_ascii_lowercase();
    let start = lower.find(&marker.to_ascii_lowercase())? + marker.len();
    let tail = value.get(start..)?;
    let id = tail.chars().take_while(|ch| ch.is_ascii_alphanumeric()).collect::<String>();
    if id.is_empty() { None } else { Some(id) }
}

fn project_aliases(raw: &Value) -> Vec<AliasRecord> {
    let mut result = Vec::new();
    let mut seen = BTreeSet::new();
    if let Some(titles) = raw.get("titles").and_then(Value::as_array) {
        for title in titles {
            let Some(text) = first_text(title, &["title"]) else { continue };
            let key = normalize_alias(&text);
            if key.is_empty() || !seen.insert(key) { continue; }
            let language = first_text(title, &["language"]);
            let title_type = if let Some(language) = language.as_deref() {
                classify_title(language).to_owned()
            } else {
                "alias".into()
            };
            result.push(AliasRecord { alias: text.chars().take(500).collect(), language, title_type });
        }
    }
    for (field, kind) in [("animeTitle", "main"), ("searchKeyword", "search_keyword")] {
        if let Some(text) = first_text(raw, &[field]) {
            let key = normalize_alias(&text);
            if !key.is_empty() && seen.insert(key) {
                result.push(AliasRecord { alias: text.chars().take(500).collect(), language: None, title_type: kind.into() });
            }
        }
    }
    result
}

fn classify_title(language: &str) -> String {
    let value = language.to_ascii_lowercase();
    if value.contains("main") || language.contains("主标题") { "main" }
    else if value.contains("official") || language.contains("官方") { "official" }
    else if value.contains("search") || language.contains("搜索") { "search_keyword" }
    else { "alias" }.into()
}

/// 保守的 Unicode 字符规范化；数据库入库前仍需统一到现有项目 normalize_alias 实现。
fn normalize_alias(value: &str) -> String {
    value.trim().to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ")
}

fn episode_id_suffix(anime_id: &str, episode_id: &str) -> Option<String> {
    let suffix = episode_id.strip_prefix(anime_id)?;
    if suffix.is_empty() || !suffix.chars().all(|ch| ch.is_ascii_digit()) { return None; }
    suffix.parse::<u64>().ok().map(|value| value.to_string())
}

fn path_tail_id(path: &str) -> Option<String> {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|tail| !tail.is_empty() && tail.chars().all(|ch| ch.is_ascii_alphanumeric()))
        .map(str::to_owned)
}

fn value_i32(value: &Value) -> Option<i32> {
    value.as_i64().and_then(|number| i32::try_from(number).ok())
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
}

fn first_text(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| value.get(*key).and_then(|candidate| {
        if candidate.is_null() { None }
        else if let Some(text) = candidate.as_str() { let text = text.trim(); (!text.is_empty()).then(|| text.to_owned()) }
        else if candidate.is_number() || candidate.is_boolean() { Some(candidate.to_string()) }
        else { None }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projects_search_results_and_episode_fields_without_arithmetic_id_guessing() {
        let body = r#"{"animes":[{"animeId":"18562","animeTitle":"药屋少女","imageUrl":"https://img/a.jpg","type":2,"typeDescription":"TV","episodeCount":2,"episodes":[{"episodeId":"185620001","episodeNumber":"SP1","episodeTitle":"特别篇"},{"episodeId":"other-7","episodeIndex":7,"episodeTitle":"第七集"}]}]}"#;
        let projection = project_response("/api/v2/search/episodes", body).unwrap();
        assert_eq!(projection.animes.len(), 1);
        assert_eq!(projection.animes[0].upstream_anime_id, "18562");
        assert_eq!(projection.episodes[0].episode_number.as_deref(), Some("SP1"));
        assert_eq!(projection.episodes[1].episode_number.as_deref(), Some("7"));
        assert_eq!(projection.episodes[1].upstream_anime_id, "18562");
    }

    #[test]
    fn projects_bangumi_aliases_external_ids_and_parent_identity() {
        let body = r#"{"bangumi":{"animeId":"42","bangumiId":"501","animeTitle":"主标题","episodes":[{"episodeId":"420001","episodeTitle":"第一集"}],"onlineDatabases":[{"name":"MyAnimeList","url":"https://myanimelist.net/anime/123/foo"},{"name":"Other Site","url":"https://other.example/x"}],"titles":[{"title":" Main Title ","language":"主标题，简体中文"},{"title":"Alias Title","language":"别名"}],"searchKeyword":"关键词"}}"#;
        let projection = project_response("/api/v2/bangumi/501", body).unwrap();
        assert_eq!(projection.seasons[0].upstream_bangumi_id.as_deref(), Some("501"));
        assert_eq!(projection.episodes[0].upstream_anime_id, "42");
        assert_eq!(projection.episodes[0].upstream_bangumi_id.as_deref(), Some("501"));
        assert_eq!(projection.external_ids[0].provider, "mal");
        assert_eq!(projection.external_ids[0].external_id.as_deref(), Some("123"));
        assert_eq!(projection.external_ids[1].external_id, None);
        assert!(projection.aliases.iter().any(|alias| alias.title_type == "main"));
        assert!(projection.aliases.iter().any(|alias| alias.title_type == "search_keyword"));
    }

    #[test]
    fn invalid_json_error_does_not_include_payload() {
        let error = project_response("/api/v2/bangumi/1", "secret-token-not-json").unwrap_err();
        assert_eq!(error, ProjectionError::InvalidJson);
        assert!(!error.to_string().contains("secret-token"));
    }
}
