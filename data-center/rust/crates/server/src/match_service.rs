//! 视频文件匹配服务
//!
//! 根据文件名、哈希、大小、时长等信息匹配对应的番剧和分集

use db::{AnimeRepo, EpisodeRepo};
use sea_orm::DatabaseConnection;
use anyhow::{Result, Context, bail};

/// 匹配请求
#[derive(Debug, Clone)]
pub struct MatchQuery {
    pub file_name: String,
    pub file_hash: Option<String>,
    pub file_size: Option<i64>,
    pub video_duration: Option<f64>,
}

/// 匹配结果
#[derive(Debug, Clone)]
pub struct MatchedItem {
    pub episode_id: i64,
    pub upstream_episode_id: String,
    pub anime_id: i64,
    pub anime_title: String,
    pub episode_title: Option<String>,
    pub episode_number: Option<String>,
    pub type_description: Option<String>,
    pub confidence: f32, // 0.0 ~ 1.0
}

/// 视频匹配服务
pub struct VideoMatchService {
    anime_repo: AnimeRepo,
    episode_repo: EpisodeRepo,
}

impl VideoMatchService {
    pub fn new(db: DatabaseConnection) -> Self {
        Self {
            anime_repo: AnimeRepo::new(db.clone()),
            episode_repo: EpisodeRepo::new(db),
        }
    }

    /// 匹配视频文件
    ///
    /// 按照以下优先级进行匹配：
    /// 1. 精确匹配：文件哈希（fileHash）
    /// 2. 半精确匹配：文件名 + 大小 + 时长
    /// 3. 模糊匹配：文件名分词匹配
    pub async fn match_video(&self, query: &MatchQuery) -> Result<Vec<MatchedItem>> {
        // TODO: 策略1 - 文件哈希精确匹配
        // 需要有 episode_file_mapping 表记录 file_hash -> episode_id
        // 这部分暂时跳过，因为需要用户手动建立映射

        // 策略2 - 文件名解析匹配
        let file_info = parse_filename(&query.file_name)?;
        
        tracing::debug!("Parsed filename: anime_title={:?}, episode_num={:?}, season={:?}", 
            file_info.anime_title, file_info.episode_number, file_info.season);

        // 根据番剧标题搜索
        let animes = self.anime_repo
            .search_by_title(&file_info.anime_title, 10)
            .await
            .context("Failed to search anime by title")?;

        if animes.is_empty() {
            // 尝试别名匹配
            let animes_by_alias = self.anime_repo
                .find_by_alias(&file_info.anime_title)
                .await
                .context("Failed to search anime by alias")?;
            
            if animes_by_alias.is_empty() {
                // 没有匹配结果
                return Ok(vec![]);
            }

            return self.build_matches(animes_by_alias, &file_info).await;
        }

        self.build_matches(animes, &file_info).await
    }

    /// 根据匹配的 anime 列表构建最终结果
    async fn build_matches(
        &self,
        animes: Vec<db::entities::anime::Model>,
        file_info: &FileInfo,
    ) -> Result<Vec<MatchedItem>> {
        let mut results = Vec::new();

        for anime in animes {
            // 查询该 anime 的所有 episodes
            let episodes = self.episode_repo
                .find_by_anime_id(anime.id)
                .await
                .context("Failed to find episodes")?;

            // 如果文件名中有集数，只匹配对应集数
            if let Some(ref ep_num) = file_info.episode_number {
                for episode in episodes {
                    if let Some(ref db_ep_num) = episode.episode_number {
                        if db_ep_num == ep_num {
                            results.push(MatchedItem {
                                episode_id: episode.id,
                                upstream_episode_id: episode.upstream_episode_id.clone(),
                                anime_id: anime.id,
                                anime_title: anime.title.clone().unwrap_or_default(),
                                episode_title: episode.title.clone(),
                                episode_number: episode.episode_number.clone(),
                                type_description: anime.type_description.clone(),
                                confidence: 0.9, // 文件名 + 集数匹配，高置信度
                            });
                        }
                    }
                }
            } else {
                // 没有明确集数，返回所有集
                for episode in episodes {
                    results.push(MatchedItem {
                        episode_id: episode.id,
                        upstream_episode_id: episode.upstream_episode_id.clone(),
                        anime_id: anime.id,
                        anime_title: anime.title.clone().unwrap_or_default(),
                        episode_title: episode.title.clone(),
                        episode_number: episode.episode_number.clone(),
                        type_description: anime.type_description.clone(),
                        confidence: 0.6, // 仅番剧名匹配，中等置信度
                    });
                }
            }
        }

        // 按置信度排序
        results.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap());

        Ok(results)
    }
}

/// 从文件名解析出的信息
#[derive(Debug, Clone)]
struct FileInfo {
    anime_title: String,
    episode_number: Option<String>,
    season: Option<String>,
}

/// 解析文件名
///
/// 支持常见的命名格式：
/// - `[字幕组] 番剧名 第01集 [1080P]`
/// - `番剧名 - 01 [字幕组]`
/// - `Anime.Title.S01E01.1080p`
/// - `番剧名 01`
fn parse_filename(filename: &str) -> Result<FileInfo> {
    // 移除文件扩展名
    let name = filename
        .rsplit_once('.')
        .map(|(name, _)| name)
        .unwrap_or(filename);

    // 移除方括号内的标签（字幕组、分辨率等）
    let cleaned = remove_brackets(name);

    // 尝试提取集数
    let (title, episode_number, season) = extract_episode_info(&cleaned);

    if title.trim().is_empty() {
        bail!("Cannot extract anime title from filename: {}", filename);
    }

    Ok(FileInfo {
        anime_title: title.trim().to_string(),
        episode_number,
        season,
    })
}

/// 移除方括号、圆括号内的内容
fn remove_brackets(text: &str) -> String {
    let mut result = String::new();
    let mut depth: i32 = 0;

    for ch in text.chars() {
        match ch {
            '[' | '【' | '(' | '（' => depth += 1,
            ']' | '】' | ')' | '）' => depth = depth.saturating_sub(1),
            _ => {
                if depth == 0 {
                    result.push(ch);
                }
            }
        }
    }

    result
}

/// 提取集数信息
///
/// 返回：(番剧标题, 集数, 季度)
fn extract_episode_info(text: &str) -> (String, Option<String>, Option<String>) {
    // 匹配常见模式（使用简单字符串匹配避免 regex 依赖）
    
    // 模式1: "番剧名 第01集" 或 "番剧名 第1话"
    if let Some(pos) = text.find("第") {
        if let Some(end_pos) = text[pos..].find(|c: char| c == '集' || c == '话' || c == '話') {
            let ep_start = pos + "第".len();
            let ep_end = pos + end_pos;
            let ep_num = text[ep_start..ep_end].trim();
            
            if !ep_num.is_empty() && ep_num.chars().all(|c| c.is_numeric()) {
                return (
                    text[..pos].trim().to_string(),
                    Some(ep_num.to_string()),
                    None,
                );
            }
        }
    }

    // 模式2: "番剧名 - 01" 或 "番剧名 01"
    for separator in [" - ", " – ", " "] {
        if let Some(pos) = text.rfind(separator) {
            let potential_num = text[pos + separator.len()..].trim();
            
            // 检查是否是 1-3 位数字（且不为空）
            if !potential_num.is_empty() 
                && potential_num.len() <= 3 
                && potential_num.chars().all(|c| c.is_numeric()) 
            {
                return (
                    text[..pos].trim().to_string(),
                    Some(potential_num.to_string()),
                    None,
                );
            }
        }
    }

    // 模式3: "Anime.Title.S01E01" (英文格式)
    if let Some(s_pos) = text.find(".S") {
        if let Some(e_pos) = text[s_pos..].find("E") {
            let season_start = s_pos + 2;
            let episode_start = s_pos + e_pos + 1;
            
            // 提取季度号和集数号
            let season_end = s_pos + e_pos;
            let episode_end = text[episode_start..]
                .find(|c: char| !c.is_numeric())
                .map(|i| episode_start + i)
                .unwrap_or(text.len());
            
            let season = text[season_start..season_end].trim();
            let episode = text[episode_start..episode_end].trim();
            
            if !season.is_empty() && !episode.is_empty() {
                return (
                    text[..s_pos].replace('.', " ").trim().to_string(),
                    Some(episode.to_string()),
                    Some(season.to_string()),
                );
            }
        }
    }

    // 无法提取集数，返回整个标题
    (text.trim().to_string(), None, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_filename_chinese() {
        let result = parse_filename("[字幕组] 药屋少女的呢喃 第01集 [1080P].mkv").unwrap();
        assert_eq!(result.anime_title, "药屋少女的呢喃");
        assert_eq!(result.episode_number, Some("01".to_string()));
    }

    #[test]
    fn test_parse_filename_dash_format() {
        let result = parse_filename("番剧名称 - 05.mp4").unwrap();
        assert_eq!(result.anime_title, "番剧名称");
        assert_eq!(result.episode_number, Some("05".to_string()));
    }

    #[test]
    fn test_parse_filename_english_sxxexx() {
        let result = parse_filename("Anime.Title.S01E12.1080p.mkv").unwrap();
        assert_eq!(result.anime_title, "Anime Title");
        assert_eq!(result.episode_number, Some("12".to_string()));
        assert_eq!(result.season, Some("01".to_string()));
    }

    #[test]
    fn test_parse_filename_no_episode() {
        let result = parse_filename("[字幕组] 番剧电影版 [BD].mkv").unwrap();
        assert_eq!(result.anime_title, "番剧电影版");
        assert_eq!(result.episode_number, None);
    }

    #[test]
    fn test_remove_brackets() {
        assert_eq!(remove_brackets("[字幕组] 番剧名 [1080P]"), " 番剧名 ");
        assert_eq!(remove_brackets("【字幕组】番剧名（中文）"), "番剧名");
    }
}
