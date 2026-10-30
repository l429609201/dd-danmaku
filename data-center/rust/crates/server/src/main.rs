use anyhow::Result;
use tracing::{info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use db;
use server;

/// 读取非空环境变量
fn env_nonempty(key: &str) -> Option<String> {
    std::env::var(key).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

/// 读取环境变量，缺失时使用默认值
fn env_or(key: &str, default: &str) -> String {
    env_nonempty(key).unwrap_or_else(|| default.to_string())
}

/// URL userinfo 百分号编码（密码中可能含 @ : / 等字符）
fn encode_userinfo(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// sqlite 文件路径转为 sqlx URL（不存在时自动创建）
fn sqlite_url(path: &str) -> String {
    if let Some(parent) = std::path::Path::new(path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    format!("sqlite://{path}?mode=rwc")
}

/// 兼容旧 Python 版 URL 写法（mysql+pymysql://、sqlite:///path 等）
fn normalize_db_url(url: &str) -> String {
    for (prefix, target) in [
        ("mysql+pymysql://", "mysql://"),
        ("mysql+aiomysql://", "mysql://"),
        ("mysql+asyncmy://", "mysql://"),
        ("postgresql+asyncpg://", "postgres://"),
        ("postgresql+psycopg2://", "postgres://"),
        ("postgresql+psycopg://", "postgres://"),
        ("postgresql://", "postgres://"),
    ] {
        if let Some(rest) = url.strip_prefix(prefix) {
            return format!("{target}{rest}");
        }
    }
    if let Some(rest) = url.strip_prefix("sqlite+aiosqlite:///").or_else(|| url.strip_prefix("sqlite:///")) {
        if rest == ":memory:" {
            return "sqlite::memory:".to_string();
        }
        // SQLAlchemy: sqlite:////abs/path 为绝对路径，sqlite:///rel 为相对路径
        return sqlite_url(rest);
    }
    url.to_string()
}

/// 解析数据库 URL：优先 DATABASE_URL，否则按旧 compose 的 DATABASE_TYPE 等变量拼接
fn resolve_db_url() -> String {
    if let Some(url) = env_nonempty("DATABASE_URL") {
        return normalize_db_url(&url);
    }
    match env_or("DATABASE_TYPE", "sqlite").to_lowercase().as_str() {
        "mysql" => format!(
            "mysql://{}:{}@{}:{}/{}",
            encode_userinfo(&env_or("MYSQL_USER", "root")),
            encode_userinfo(&env_or("MYSQL_PASSWORD", "")),
            env_or("MYSQL_HOST", "localhost"),
            env_or("MYSQL_PORT", "3306"),
            env_or("MYSQL_DATABASE", "danmu_data_center"),
        ),
        "postgresql" | "postgres" => format!(
            "postgres://{}:{}@{}:{}/{}",
            encode_userinfo(&env_or("POSTGRES_USER", "postgres")),
            encode_userinfo(&env_or("POSTGRES_PASSWORD", "")),
            env_or("POSTGRES_HOST", "localhost"),
            env_or("POSTGRES_PORT", "5432"),
            env_or("POSTGRES_DATABASE", "danmu_data_center"),
        ),
        _ => sqlite_url(&env_or("SQLITE_PATH", "/app/config/database.db")),
    }
}

/// 隐藏 URL 中的密码，仅用于日志
fn mask_db_url(url: &str) -> String {
    match (url.find("://"), url.rfind('@')) {
        (Some(s), Some(at)) if at > s => {
            let user_end = url[s + 3..at].find(':').map(|i| s + 3 + i).unwrap_or(at);
            format!("{}:****{}", &url[..user_end], &url[at..])
        }
        _ => url.to_string(),
    }
}

/// 把旧 compose 变量映射到 Rust 版变量（仅在新变量未设置时生效）
fn apply_legacy_env() {
    let set_default = |key: &str, value: Option<String>| {
        if env_nonempty(key).is_none() {
            if let Some(v) = value {
                std::env::set_var(key, v);
            }
        }
    };
    // HOST/PORT → LISTEN_ADDR
    if env_nonempty("HOST").is_some() || env_nonempty("PORT").is_some() {
        set_default(
            "LISTEN_ADDR",
            Some(format!("{}:{}", env_or("HOST", "0.0.0.0"), env_or("PORT", "7759"))),
        );
    }
    // SECRET_KEY → JWT_SECRET
    set_default("JWT_SECRET", env_nonempty("SECRET_KEY"));
    // CONFIG_PATH → DANMAKU_STORE_DIR（{CONFIG_PATH}/danmaku）
    set_default("DANMAKU_STORE_DIR", env_nonempty("CONFIG_PATH").map(|p| format!("{p}/danmaku")));
}

#[tokio::main]
async fn main() -> Result<()> {
    // 日志级别：RUST_LOG 优先，其次旧 compose 的 LOG_LEVEL
    let filter = tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        let level = env_or("LOG_LEVEL", "info").to_lowercase();
        let level = if level == "warning" { "warn".to_string() } else { level };
        format!("{level},sqlx=warn").into()
    });
    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Starting data-center Rust backend v{}", env!("CARGO_PKG_VERSION"));

    // 环境变量单线程阶段处理（tokio worker 尚未读取 env）
    apply_legacy_env();
    let db_url = resolve_db_url();
    info!("🗄️ 数据库: {}", mask_db_url(&db_url));

    let db_config = db::DbConfig {
        url: db_url,
        max_connections: 80,
        min_connections: 10,
        ..Default::default()
    };
    let db = db::init_db(&db_config).await?;

    // 启动时补齐表结构（只建缺失的表/索引，不改已有数据）
    db::schema::ensure_schema(&db).await?;
    info!("✅ 数据库表结构已就绪");

    // 首次启动按 ADMIN_USERNAME/ADMIN_PASSWORD 创建管理员
    if let Err(e) = server::init_admin_from_env(&db).await {
        warn!("⚠️ 初始化管理员失败: {e:#}");
    }

    let addr = env_or("LISTEN_ADDR", "0.0.0.0:7759");
    info!("Database initialized, starting server...");
    server::run_server(db, &addr).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_db_url() {
        assert_eq!(normalize_db_url("mysql+pymysql://u:p@h:3306/d"), "mysql://u:p@h:3306/d");
        assert_eq!(normalize_db_url("postgresql://u:p@h/d"), "postgres://u:p@h/d");
        assert_eq!(normalize_db_url("mysql://u:p@h/d"), "mysql://u:p@h/d");
        assert_eq!(normalize_db_url("sqlite:///:memory:"), "sqlite::memory:");
    }

    #[test]
    fn test_encode_and_mask() {
        assert_eq!(encode_userinfo("p@ss:w/d"), "p%40ss%3Aw%2Fd");
        assert_eq!(mask_db_url("mysql://root:secret@db:3306/x"), "mysql://root:****@db:3306/x");
    }
}
