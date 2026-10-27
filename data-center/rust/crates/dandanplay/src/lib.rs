//! dandanplay 响应解析的纯数据层。
//!
//! 此 crate 不访问数据库或网络，使旧库 JSON 回填映射可以在离线 fixture 上验证。
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq)]
pub struct ParsedResponse {
    pub anime: Option<AnimeRecord>,
    pub episodes: Vec<EpisodeRecord>,
    pub external_ids: Vec<ExternalIdRecord>,
    pub aliases: Vec<AliasRecord>,
    /// 原始 JSON 原样保留，供兼容重建或未覆盖字段回填。
    pub raw: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AnimeRecord {
    pub upstream_anime_id: String,
    pub title: Option<String>,
    pub image_url: Option<String>,
    pub type_code: Option<String>,
    pub type_description: Option<String>,
    pub summary: Option<String>,
    pub rating: Option<String>,
    pub start_date: Option<String>,
    pub episode_count: Option<u64>,
    pub source_kind: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct EpisodeRecord {
    pub upstream_episode_id: String,
    pub upstream_anime_id: String,
    pub episode_number: Option<String>,
    pub title: Option<String>,
    pub type_description: Option<String>,
    pub duration_seconds: Option<u64>,
    pub air_date: Option<String>,
    pub raw: Value,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExternalIdRecord {
    pub provider: String,
    pub external_id: Option<String>,
    pub external_url: String,
    pub confidence: u8,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AliasRecord {
    pub alias: String,
    pub alias_norm: String,
    pub lang: Option<String>,
    pub title_type: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ParseError {
    InvalidJson,
    UnsupportedResponse,
    MissingAnimeId,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ResponseKind {
    Search,
    Bangumi,
}

/// 解析 /search/anime、/search/episodes 或 /bangumi/{id} 的响应体。
/// animeId 始终从父级读取；绝不对 episodeId 进行算术反推。
pub fn parse_response(api_path: &str, body: &str) -> Result<ParsedResponse, ParseError> {
    let raw: Value = serde_json::from_str(body).map_err(|_| ParseError::InvalidJson)?;
    let kind = if api_path.contains("/search/anime") || api_path.contains("/search/episodes") {
        ResponseKind::Search
    } else if api_path.contains("/bangumi/") {
        ResponseKind::Bangumi
    } else {
        return Err(ParseError::UnsupportedResponse);
    };

    let mut records = ParsedResponse {
        anime: None,
        episodes: Vec::new(),
        external_ids: Vec::new(),
        aliases: Vec::new(),
        raw: raw.clone(),
    };

    match kind {
        ResponseKind::Search => {
            if let Some(animes) = raw.get("animes").and_then(Value::as_array) {
                for item in animes {
                    let anime_id = first_string(item, &["animeId", "bangumiId"])
                        .ok_or(ParseError::MissingAnimeId)?;
                    let title = first_string(item, &["animeTitle", "title"]);
                    records.anime = Some(parse_anime(&anime_id, item, "search_anime"));
                    append_episodes(&mut records.episodes, item, &anime_id, title.as_deref());
                }
            }
            if records.anime.is_none() {
                return Err(ParseError::UnsupportedResponse);
            }
        }
        ResponseKind::Bangumi => {
            let bangumi = raw.get("bangumi").unwrap_or(&raw);
            let anime_id = first_string(bangumi, &["animeId"]).ok_or(ParseError::MissingAnimeId)?;
            records.anime = Some(parse_anime(&anime_id, bangumi, "bangumi"));
            append_episodes(
                &mut records.episodes,
                bangumi,
                &anime_id,
                first_string(bangumi, &["animeTitle", "title"]).as_deref(),
            );
            records.external_ids = parse_external_ids(bangumi);
            records.aliases = parse_aliases(bangumi);
        }
    }

    Ok(records)
}

fn parse_anime(anime_id: &str, item: &Value, source_kind: &str) -> AnimeRecord {
    let episode_count = item
        .get("episodeCount")
        .and_then(Value::as_u64)
        .or_else(|| item.get("episodes").and_then(Value::as_array).map(|items| items.len() as u64));
    AnimeRecord {
        upstream_anime_id: anime_id.to_owned(),
        title: first_string(item, &["animeTitle", "title"]),
        image_url: first_string(item, &["imageUrl"]),
        type_code: scalar_string(item.get("type")),
        type_description: first_string(item, &["typeDescription"]),
        summary: first_string(item, &["summary"]),
        rating: scalar_string(item.get("rating")),
        start_date: first_string(item, &["startDate", "airDate"]),
        episode_count,
        source_kind: source_kind.to_owned(),
    }
}

fn append_episodes(target: &mut Vec<EpisodeRecord>, parent: &Value, anime_id: &str, anime_title: Option<&str>) {
    let Some(episodes) = parent.get("episodes").and_then(Value::as_array) else {
        return;
    };
    for item in episodes {
        let Some(episode_id) = first_string(item, &["episodeId"]) else {
            continue;
        };
        let episode_number = first_string(item, &["episodeNumber", "episodeIndex", "episodeNo"])
            .or_else(|| episode_number_from_parent_id(&episode_id, anime_id));
        target.push(EpisodeRecord {
            upstream_episode_id: episode_id,
            upstream_anime_id: anime_id.to_owned(),
            episode_number,
            title: first_string(item, &["episodeTitle", "title"]),
            type_description: first_string(item, &["typeDescription"]),
            duration_seconds: item.get("duration").and_then(Value::as_u64),
            air_date: first_string(item, &["airDate", "startDate"]),
            raw: item.clone(),
        });
    }
    // The anime title is inherited from the parent in the normalized anime row;
    // episode title remains the upstream episodeTitle, including None when absent.
    let _ = anime_title;
}

fn episode_number_from_parent_id(episode_id: &str, anime_id: &str) -> Option<String> {
    let suffix = episode_id.strip_prefix(anime_id)?;
    if suffix.is_empty() || !suffix.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    suffix.parse::<u64>().ok().map(|number| number.to_string())
}

fn parse_external_ids(raw: &Value) -> Vec<ExternalIdRecord> {
    let mut records = Vec::new();
    let mut seen = BTreeSet::new();
    if let Some(items) = raw.get("onlineDatabases").and_then(Value::as_array) {
        for item in items {
            let Some(url) = first_string(item, &["url"]).filter(|value| !value.is_empty()) else {
                continue;
            };
            let name = first_string(item, &["name"]).unwrap_or_default();
            let (provider, external_id) = extract_provider_id(&url)
                .map(|(provider, id)| (provider.to_owned(), Some(id.to_owned())))
                .unwrap_or_else(|| (provider_from_name(&name), None));
            if provider.is_empty() || !seen.insert(provider.clone()) {
                continue;
            }
            records.push(ExternalIdRecord {
                provider,
                confidence: if external_id.is_some() { 95 } else { 70 },
                external_id,
                external_url: url.chars().take(500).collect(),
            });
        }
    }
    if !seen.contains("bangumi_tv") {
        if let Some(url) = first_string(raw, &["bangumiUrl"]) {
            if let Some((provider, external_id)) = extract_provider_id(&url) {
                if provider == "bangumi_tv" {
                    records.push(ExternalIdRecord {
                        provider: provider.to_owned(),
                        external_id: Some(external_id.to_owned()),
                        external_url: url.chars().take(500).collect(),
                        confidence: 95,
                    });
                }
            }
        }
    }
    records
}

fn extract_provider_id(url: &str) -> Option<(&'static str, &str)> {
    let lower = url.to_ascii_lowercase();
    let (provider, marker) = if lower.contains("bangumi.tv/subject/") {
        ("bangumi_tv", "bangumi.tv/subject/")
    } else if lower.contains("anidb.net/anime/") {
        ("anidb", "anidb.net/anime/")
    } else if lower.contains("myanimelist.net/anime/") {
        ("mal", "myanimelist.net/anime/")
    } else if lower.contains("anilist.co/anime/") {
        ("anilist", "anilist.co/anime/")
    } else if lower.contains("themoviedb.org/tv/") {
        ("tmdb", "themoviedb.org/tv/")
    } else if lower.contains("themoviedb.org/movie/") {
        ("tmdb", "themoviedb.org/movie/")
    } else if lower.contains("imdb.com/title/") {
        ("imdb", "imdb.com/title/")
    } else if lower.contains("thetvdb.com/dereferrer/series/") {
        ("tvdb", "thetvdb.com/dereferrer/series/")
    } else if lower.contains("thetvdb.com/series/") {
        ("tvdb", "thetvdb.com/series/")
    } else if lower.contains("anisearch.com/anime/") {
        ("anisearch", "anisearch.com/anime/")
    } else if lower.contains("anime-planet.com/anime/") {
        ("animeplanet", "anime-planet.com/anime/")
    } else if lower.contains("notify.moe/anime/") {
        ("notifymoe", "notify.moe/anime/")
    } else {
        return None;
    };
    let rest = &url[lower.find(marker)? + marker.len()..];
    let id = rest.split(['/', '?', '&', '#']).next()?.trim();
    (!id.is_empty()).then_some((provider, id))
}

fn provider_from_name(name: &str) -> String {
    let lower = name.trim().to_ascii_lowercase();
    match lower.as_str() {
        "bangumi.tv" => "bangumi_tv".into(),
        "anidb" => "anidb".into(),
        "myanimelist" => "mal".into(),
        "anilist" => "anilist".into(),
        "anisearch" => "anisearch".into(),
        "animeplanet" | "anime-planet" => "animeplanet".into(),
        "tmdb" | "themoviedb" => "tmdb".into(),
        "imdb" => "imdb".into(),
        "thetvdb" | "tvdb" => "tvdb".into(),
        "notify.moe" => "notifymoe".into(),
        _ => lower
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
            .collect::<String>()
            .trim_matches('_')
            .to_owned(),
    }
}

fn parse_aliases(raw: &Value) -> Vec<AliasRecord> {
    let mut records = Vec::new();
    let mut seen = BTreeSet::new();
    if let Some(items) = raw.get("titles").and_then(Value::as_array) {
        for item in items {
            append_alias(
                &mut records,
                &mut seen,
                first_string(item, &["title"]).as_deref(),
                first_string(item, &["language"]).as_deref(),
                "alias",
            );
        }
    }
    append_alias(
        &mut records,
        &mut seen,
        first_string(raw, &["animeTitle"]).as_deref(),
        None,
        "main",
    );
    append_alias(
        &mut records,
        &mut seen,
        first_string(raw, &["searchKeyword"]).as_deref(),
        None,
        "search_keyword",
    );
    records
}

fn append_alias(
    target: &mut Vec<AliasRecord>,
    seen: &mut BTreeSet<String>,
    alias: Option<&str>,
    language: Option<&str>,
    fallback_type: &str,
) {
    let Some(alias) = alias.map(str::trim).filter(|value| !value.is_empty()) else {
        return;
    };
    let normalized = normalize_alias(alias);
    if normalized.is_empty() || !seen.insert(normalized.clone()) {
        return;
    }
    let (lang, title_type) = language
        .map(parse_language)
        .unwrap_or((None, fallback_type.to_owned()));
    target.push(AliasRecord {
        alias: alias.chars().take(500).collect(),
        alias_norm: normalized.chars().take(500).collect(),
        lang,
        title_type,
    });
}

fn parse_language(language: &str) -> (Option<String>, String) {
    let title_type = if language.contains("主标题") {
        "main"
    } else if language.contains("官方标题") {
        "official"
    } else if language.contains("搜索关键词") {
        "search_keyword"
    } else {
        "alias"
    }
    .to_owned();
    let lang = [
        ("日语罗马字", "ja-romaji"),
        ("简体中文", "zh-Hans"),
        ("繁体中文", "zh-Hant"),
        ("日语", "ja"),
        ("英语", "en"),
        ("中文", "zh"),
    ]
    .iter()
    .find(|(needle, _)| language.contains(needle))
    .map(|(_, value)| (*value).to_owned());
    (lang, title_type)
}

/// NFKC 全角兼容折叠、小写、合并空白；不会去除标点，贴合旧索引规则。
fn normalize_alias(alias: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    let mut normalized = String::new();
    let mut in_whitespace = false;
    for ch in alias.trim().nfkc().flat_map(char::to_lowercase) {
        if ch.is_whitespace() {
            if !in_whitespace && !normalized.is_empty() {
                normalized.push(' ');
            }
            in_whitespace = true;
        } else {
            normalized.push(ch);
            in_whitespace = false;
        }
    }
    normalized.trim().to_owned()
}

fn first_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(|v| scalar_string(Some(v))))
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn scalar_string(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_search_response_with_nested_episodes_and_keeps_raw_json() {
        let body = r#"{"animes":[{"animeId":18562,"animeTitle":"药屋少女","episodeCount":2,"episodes":[{"episodeId":185620001,"episodeNumber":"SP1","episodeTitle":"特别篇"},{"episodeId":185620002,"episodeIndex":2,"episodeTitle":"第二话"}]}]}"#;
        let parsed = parse_response("/api/v2/search/anime", body).unwrap();
        assert_eq!(parsed.anime.as_ref().unwrap().upstream_anime_id, "18562");
        assert_eq!(parsed.episodes.len(), 2);
        assert_eq!(parsed.episodes[0].upstream_anime_id, "18562");
        assert_eq!(parsed.episodes[0].episode_number.as_deref(), Some("SP1"));
        assert_eq!(parsed.episodes[1].episode_number.as_deref(), Some("2"));
        assert_eq!(parsed.raw["animes"][0]["episodes"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn parses_bangumi_external_ids_and_aliases_deterministically() {
        let body = r#"{"bangumi":{"animeId":"18562","animeTitle":"主标题","searchKeyword":" keyword ","onlineDatabases":[{"name":"TMDB","url":"https://www.themoviedb.org/tv/123"},{"name":"Unknown Platform","url":"https://other.invalid/id/9"}],"titles":[{"title":"作品名","language":"官方标题，简体中文"},{"title":"作品名","language":"别名，日语"},{"title":"  Foo　BAR ","language":"别名，英语"}]}}"#;
        let parsed = parse_response("/api/v2/bangumi/18562", body).unwrap();
        assert_eq!(parsed.external_ids.len(), 2);
        assert_eq!(parsed.external_ids[0].provider, "tmdb");
        assert_eq!(parsed.external_ids[0].external_id.as_deref(), Some("123"));
        assert_eq!(parsed.external_ids[1].external_id, None);
        // "作品名" appears twice but should dedupe to 1, plus "主标题", "keyword", "Foo BAR" = 4 total
        assert_eq!(parsed.aliases.len(), 4);
        assert_eq!(parsed.aliases[0].alias_norm, "作品名");
        assert_eq!(parsed.aliases[0].lang.as_deref(), Some("zh-Hans"));
        assert_eq!(parsed.aliases[0].title_type, "official");
        assert!(parsed.aliases.iter().any(|a| a.alias_norm == "foo bar"));
    }

    #[test]
    fn never_infers_anime_id_from_episode_id() {
        let body = r#"{"animes":[{"animeId":"abc","episodes":[{"episodeId":"999001","episodeTitle":"No number"}]}]}"#;
        let parsed = parse_response("/search/episodes", body).unwrap();
        assert_eq!(parsed.episodes[0].upstream_anime_id, "abc");
        assert_eq!(parsed.episodes[0].episode_number, None);
    }

    #[test]
    fn rejects_invalid_or_unrecognized_responses() {
        assert_eq!(parse_response("/search/anime", "{"), Err(ParseError::InvalidJson));
        assert_eq!(parse_response("/api/v2/comment/1", "{}"), Err(ParseError::UnsupportedResponse));
        assert_eq!(parse_response("/bangumi/1", "{\"bangumi\":{}}"), Err(ParseError::MissingAnimeId));
    }
}
