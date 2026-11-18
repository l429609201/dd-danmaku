/// 服务器日志文件读取 API（只读，不写入或删除日志文件）
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
    Json,
};
use futures_util::stream::{self, Stream};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use tokio::io::AsyncBufReadExt;

use crate::AppState;

/// 列出可用日志文件（返回日志目录中的所有 .log 文件）
#[derive(Debug, Serialize)]
pub struct LogFileInfo {
    /// 文件名（不含路径）
    pub name: String,
    /// 文件大小（字节）
    pub size_bytes: u64,
    /// 最后修改时间（ISO 8601 字符串）
    pub modified_at: Option<String>,
    /// 是否为今日日志
    pub is_today: bool,
}

#[derive(Debug, Serialize)]
pub struct LogFilesResponse {
    pub files: Vec<LogFileInfo>,
    /// 日志目录路径（脱敏后，仅最后一段）
    pub log_dir_name: String,
}

/// 单条日志记录
#[derive(Debug, Serialize)]
pub struct LogEntry {
    /// 原始行内容
    pub raw: String,
    /// 解析出的时间戳（如果能解析）
    pub timestamp: Option<String>,
    /// 日志级别（TRACE/DEBUG/INFO/WARN/ERROR）
    pub level: Option<String>,
    /// 目标模块
    pub target: Option<String>,
    /// 消息正文
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LogEntriesResponse {
    pub entries: Vec<LogEntry>,
    pub total_lines: u64,
    pub page: u64,
    pub page_size: u64,
    pub file: String,
}

/// 查询参数
#[derive(Debug, Deserialize)]
pub struct ServerLogsQuery {
    /// 文件名（不含路径），省略时使用最新文件
    pub file: Option<String>,
    #[serde(default = "default_page")]
    pub page: u64,
    #[serde(default = "default_page_size")]
    pub page_size: u64,
    /// 过滤指定级别（大小写不敏感），省略时不过滤
    pub level: Option<String>,
    /// 关键词过滤（模糊匹配原始行内容），省略时不过滤
    pub keyword: Option<String>,
    /// SSE 鉴权 token（通过 query string 传递，仅 stream 接口使用）
    /// EventSource 不支持自定义请求头，因此 SSE 接口必须通过 ?token= 传递 JWT
    pub token: Option<String>,
}

fn default_page() -> u64 { 1 }
fn default_page_size() -> u64 { 100 }

/// 获取日志目录路径
fn log_dir() -> PathBuf {
    let config_path = std::env::var("CONFIG_PATH")
        .unwrap_or_else(|_| "/app/config".to_string());
    PathBuf::from(config_path).join("logs")
}

/// 解析 tracing 格式日志行：`YYYY-MM-DDTHH:MM:SS.nnZ LEVEL target: message`
/// 也兼容 `YYYY-MM-DD HH:MM:SS LEVEL target: message`
fn parse_log_line(raw: &str) -> LogEntry {
    // 尝试解析格式：`2024-01-01T00:00:00.000000000Z  INFO crate::mod: message`
    // 时间戳部分：ISO-8601 或空格分隔的日期时间
    let raw = raw.trim();

    // 找到时间戳（以 2 开头，空格或 T 分隔日期时间）
    if raw.len() < 10 || !raw.starts_with("20") {
        return LogEntry { raw: raw.to_string(), timestamp: None, level: None, target: None, message: None };
    }

    // 分割：时间戳 + 其余部分
    // tracing 格式大约是: `2024-01-01T00:00:00.000000000Z  INFO target: message`
    let parts: Vec<&str> = raw.splitn(2, ' ').collect();
    if parts.len() < 2 {
        return LogEntry { raw: raw.to_string(), timestamp: None, level: None, target: None, message: None };
    }
    let timestamp_raw = parts[0];
    let rest = parts[1].trim();

    // 从 rest 中解析 LEVEL（全大写，1-5 字符）
    let level_end = rest.find(|c: char| !c.is_uppercase()).unwrap_or(0);
    if level_end == 0 || level_end > 5 {
        return LogEntry { raw: raw.to_string(), timestamp: Some(timestamp_raw.to_string()), level: None, target: None, message: None };
    }
    let level = &rest[..level_end];
    let after_level = rest[level_end..].trim();

    // 分割目标和消息：`target: message`
    let (target, message) = if let Some(colon_pos) = after_level.find(": ") {
        let t = after_level[..colon_pos].trim().to_string();
        let m = after_level[colon_pos + 2..].to_string();
        (Some(t), Some(m))
    } else {
        (None, Some(after_level.to_string()))
    };

    LogEntry {
        raw: raw.to_string(),
        timestamp: Some(timestamp_raw.to_string()),
        level: Some(level.to_string()),
        target,
        message,
    }
}

/// GET /api/v2/logs/server-files — 列出可用日志文件
pub async fn list_server_log_files(
    State(_state): State<AppState>,
) -> Result<Json<LogFilesResponse>, (StatusCode, String)> {
    let log_dir = log_dir();
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();

    let mut files = Vec::new();

    // 读取目录（不存在时返回空列表）
    match tokio::fs::read_dir(&log_dir).await {
        Ok(mut dir) => {
            while let Ok(Some(entry)) = dir.next_entry().await {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.ends_with(".log") {
                    continue;
                }
                let meta = entry.metadata().await.ok();
                let size_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
                let modified_at = meta.as_ref()
                    .and_then(|m| m.modified().ok())
                    .map(|t| {
                        let dt: chrono::DateTime<chrono::Utc> = t.into();
                        dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()
                    });
                let is_today = name.contains(&today);
                files.push(LogFileInfo { name, size_bytes, modified_at, is_today });
            }
        }
        Err(_) => {
            // 目录不存在或无法读取，返回空列表
        }
    }

    // 按修改时间降序排列（最新在前）
    files.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));

    let log_dir_name = log_dir.file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "logs".to_string());

    Ok(Json(LogFilesResponse { files, log_dir_name }))
}

/// GET /api/v2/logs/server-logs — 分页读取日志文件内容
pub async fn get_server_logs(
    State(_state): State<AppState>,
    Query(query): Query<ServerLogsQuery>,
) -> Result<Json<LogEntriesResponse>, (StatusCode, String)> {
    // 参数校验
    let page = query.page.max(1);
    let page_size = query.page_size.max(1).min(500);

    let log_dir = log_dir();

    // 确定文件名：指定文件或最新文件
    let file_name = if let Some(ref f) = query.file {
        // 安全检查：文件名不能包含路径分隔符
        if f.contains('/') || f.contains('\\') || f.contains("..") {
            return Err((StatusCode::BAD_REQUEST, "文件名不合法".to_string()));
        }
        f.clone()
    } else {
        // 查找最新 .log 文件
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let today_file = format!("data-center-{}.log", today);
        // 优先使用今日文件，不存在则回退到目录中最新文件
        let today_path = log_dir.join(&today_file);
        if today_path.exists() {
            today_file
        } else {
            find_latest_log_file(&log_dir).await
                .ok_or((StatusCode::NOT_FOUND, "未找到日志文件".to_string()))?
        }
    };

    let file_path = log_dir.join(&file_name);

    // 安全检查：路径必须在 log_dir 内
    let canonical_dir = tokio::fs::canonicalize(&log_dir).await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "无法解析日志目录".to_string()))?;
    // 允许文件不存在时直接 canonicalize 失败，改为手动拼接检查
    let expected_prefix = canonical_dir.join(&file_name);
    if !expected_prefix.starts_with(&canonical_dir) {
        return Err((StatusCode::BAD_REQUEST, "文件名不合法".to_string()));
    }

    // 读取文件所有行（带行级过滤）
    let f = tokio::fs::File::open(&file_path).await
        .map_err(|_| (StatusCode::NOT_FOUND, format!("日志文件不存在: {}", file_name)))?;

    let reader = tokio::io::BufReader::new(f);
    let mut lines = reader.lines();

    // 读取所有匹配的行
    let level_filter = query.level.as_deref().map(|l| l.to_uppercase());
    let keyword_filter = query.keyword.as_deref().map(|k| k.to_lowercase());

    let mut matched_lines: Vec<String> = Vec::new();
    while let Ok(Some(line)) = lines.next_line().await {
        // 关键词过滤
        if let Some(ref kw) = keyword_filter {
            if !line.to_lowercase().contains(kw.as_str()) {
                continue;
            }
        }
        // 级别过滤（粗匹配：行中出现该级别单词）
        if let Some(ref lv) = level_filter {
            let upper = line.to_uppercase();
            // 避免误匹配（如 DEBUG 中含 BUG），使用空格包围检查
            let lv_padded = format!(" {} ", lv);
            if !upper.contains(&lv_padded) {
                continue;
            }
        }
        matched_lines.push(line);
    }

    let total_lines = matched_lines.len() as u64;

    // 分页
    let offset = (page - 1) * page_size;
    let slice = matched_lines
        .into_iter()
        .skip(offset as usize)
        .take(page_size as usize)
        .map(|raw| parse_log_line(&raw))
        .collect::<Vec<_>>();

    Ok(Json(LogEntriesResponse {
        entries: slice,
        total_lines,
        page,
        page_size,
        file: file_name,
    }))
}

/// 在日志目录中查找最新的 .log 文件（按修改时间）
async fn find_latest_log_file(log_dir: &PathBuf) -> Option<String> {
    let mut dir = tokio::fs::read_dir(log_dir).await.ok()?;
    let mut best: Option<(String, std::time::SystemTime)> = None;

    while let Ok(Some(entry)) = dir.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".log") { continue; }
        if let Ok(meta) = entry.metadata().await {
            if let Ok(modified) = meta.modified() {
                let better = best.as_ref().map(|(_, t)| modified > *t).unwrap_or(true);
                if better {
                    best = Some((name, modified));
                }
            }
        }
    }
    best.map(|(name, _)| name)
}

/// SSE 实时日志流：持续推送新增的日志行
/// 注意：EventSource 不支持自定义请求头，鉴权通过 ?token= 查询参数传递。
/// 该路由不加入受 auth 中间件保护的路由组，而是在处理函数内部手动验证 token。
pub async fn stream_server_logs(
    State(state): State<AppState>,
    Query(query): Query<ServerLogsQuery>,
) -> Result<Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>, StatusCode> {
    // 手动验证 token（EventSource 无法设置 Authorization 头）
    let token = query.token.as_deref().unwrap_or("").trim();
    if token.is_empty() {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // 验证 JWT 签名
    let claims = state.jwt.verify_token(token)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    // 核验 DB 中的会话有效性（与普通 auth 中间件逻辑保持一致）
    let user_id = claims.sub.parse::<i64>().map_err(|_| StatusCode::UNAUTHORIZED)?;
    let session = db::SessionRepo::find_by_token(&state.db, token)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::UNAUTHORIZED)?;
    if session.user_id != user_id {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let user = db::UserRepo::find_by_id(&state.db, user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::UNAUTHORIZED)?;
    if !user.is_active || user.role != "admin" {
        return Err(StatusCode::FORBIDDEN);
    }

    let log_dir = log_dir();
    let level_filter = query.level.clone();
    let keyword_filter = query.keyword.clone();

    // 确定要监控的文件
    let file_name = if let Some(name) = query.file {
        Some(name)
    } else {
        // 默认选择今天的文件
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let today_file = format!("data-center-{}.log", today);
        if log_dir.join(&today_file).exists() {
            Some(today_file)
        } else {
            // 今天的文件不存在，回退到最新文件
            find_latest_log_file(&log_dir).await
        }
    };

    let stream = async_stream::stream! {
        use tokio::fs::File;
        use tokio::io::{AsyncSeekExt, BufReader};

        // 检查是否有可用文件
        let file_name = match file_name {
            Some(name) => name,
            None => {
                yield Ok(Event::default().data("没有可用的日志文件"));
                return;
            }
        };

        let file_path = log_dir.join(&file_name);

        // 打开文件并定位到末尾
        let mut file = match File::open(&file_path).await {
            Ok(f) => f,
            Err(e) => {
                yield Ok(Event::default().data(format!("无法打开日志文件: {}", e)));
                return;
            }
        };

        // 移动到文件末尾（只推送新内容）
        if let Err(e) = file.seek(std::io::SeekFrom::End(0)).await {
            yield Ok(Event::default().data(format!("定位文件末尾失败: {}", e)));
            return;
        }

        let mut reader = BufReader::new(file);
        let mut line_buffer = String::new();
        let mut current_date = chrono::Local::now().format("%Y-%m-%d").to_string();

        loop {
            line_buffer.clear();
            match reader.read_line(&mut line_buffer).await {
                Ok(0) => {
                    // EOF，等待 500ms 后重试
                    tokio::time::sleep(Duration::from_millis(500)).await;

                    // 检查是否跨日期（日志轮转）
                    let now_date = chrono::Local::now().format("%Y-%m-%d").to_string();
                    if now_date != current_date {
                        current_date = now_date.clone();
                        let new_file = format!("data-center-{}.log", now_date);
                        let new_path = log_dir.join(&new_file);

                        // 尝试切换到新文件
                        if new_path.exists() {
                            match File::open(&new_path).await {
                                Ok(f) => {
                                    reader = BufReader::new(f);
                                    yield Ok(Event::default()
                                        .event("file_rotated")
                                        .data(format!("日志文件已轮转至: {}", new_file)));
                                }
                                Err(_) => {
                                    // 切换失败，继续读旧文件
                                }
                            }
                        }
                    }
                    continue;
                }
                Ok(_) => {
                    // 读到新行
                    let raw = line_buffer.trim_end().to_string();
                    if raw.is_empty() {
                        continue;
                    }

                    // 解析日志行
                    let entry = parse_log_line(&raw);

                    // 应用过滤条件
                    if let Some(ref level) = level_filter {
                        let entry_level = entry.level.as_deref().unwrap_or("").to_lowercase();
                        let filter = level.to_lowercase();

                        // 级别过滤：ERROR > WARN > INFO > DEBUG
                        let skip = match filter.as_str() {
                            "error" => !matches!(entry_level.as_str(), "error"),
                            "warn" | "warning" => !matches!(entry_level.as_str(), "error" | "warn" | "warning"),
                            "info" => entry_level == "debug",
                            _ => false,
                        };

                        if skip {
                            continue;
                        }
                    }

                    if let Some(ref keyword) = keyword_filter {
                        if !keyword.is_empty() && !raw.to_lowercase().contains(&keyword.to_lowercase()) {
                            continue;
                        }
                    }

                    // 推送日志行
                    let json = serde_json::json!({
                        "timestamp": entry.timestamp,
                        "level": entry.level,
                        "target": entry.target,
                        "message": entry.message,
                    });

                    yield Ok(Event::default().data(json.to_string()));
                }
                Err(e) => {
                    yield Ok(Event::default().data(format!("读取日志失败: {}", e)));
                    return;
                }
            }
        }
    };

    Ok(Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keepalive")
    ))
}
