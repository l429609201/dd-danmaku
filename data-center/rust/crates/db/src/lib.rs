use sea_orm::{ConnectOptions, Database, DatabaseConnection, DbErr};
use std::time::Duration;
use tracing::info;

pub mod entities;
pub mod schema;
pub mod migration;
pub mod repo_control_node;
pub mod repo_control_message;
pub mod repo_runtime_event;
pub mod repo_cache;
pub mod repo_anime;
pub mod repo_user;
pub mod repo_config;
pub mod repo_rules;
pub mod repo_stage_5_7;
pub mod comment_store;

// 测试辅助工具也对外暴露，供集成测试使用
#[cfg(any(test, feature = "test-helpers"))]
pub mod test_helper;

pub use repo_control_node::ControlNodeRepo;
pub use repo_control_message::{ControlMessageRepo, MessageQuery};
pub use repo_runtime_event::{RuntimeEventRepo, EventQuery};
pub use repo_cache::CacheRepo;
pub use repo_anime::{AnimeRepo, EpisodeRepo};
pub use repo_user::{UserRepo, SessionRepo, ApiTokenRepo};
pub use repo_config::{ConfigRepo, ConfigSecretRepo};
pub use repo_rules::{IpRuleRepo, UaRuleRepo};
pub use repo_stage_5_7::{
    ApiKeyPoolRepo, SignKeyPoolRepo, UserAllowPoolRepo, OAuthConfigRepo,
    WorkerLogRepo, IpStatsRepo, CleanupPolicyRepo
};
pub use comment_store::{CommentStoreService, DanmakuResponse, DanmakuComment};

// 导出数据库配置和初始化函数
pub use self::{DbConfig, init_db};

/// 数据库配置
#[derive(Debug, Clone)]
pub struct DbConfig {
    pub url: String,
    pub max_connections: u32,
    pub min_connections: u32,
    pub connect_timeout: Duration,
    pub idle_timeout: Duration,
}

impl Default for DbConfig {
    fn default() -> Self {
        Self {
            url: "sqlite::memory:".to_string(),
            max_connections: 80,  // DB_POOL_SIZE + DB_MAX_OVERFLOW
            min_connections: 10,
            connect_timeout: Duration::from_secs(5),
            idle_timeout: Duration::from_secs(600),
        }
    }
}

/// 初始化数据库连接池
pub async fn init_db(config: &DbConfig) -> Result<DatabaseConnection, DbErr> {
    let mut opt = ConnectOptions::new(&config.url);
    opt.max_connections(config.max_connections)
        .min_connections(config.min_connections)
        .connect_timeout(config.connect_timeout)
        .idle_timeout(config.idle_timeout)
        .sqlx_logging(true)  // 开发阶段启用，生产环境可配置
        .sqlx_logging_level(tracing::log::LevelFilter::Debug);

    info!(
        "Connecting to database: {} (max_conn: {}, min_conn: {})",
        mask_db_url(&config.url),
        config.max_connections,
        config.min_connections
    );

    let db = Database::connect(opt).await?;
    info!("Database connection pool established");
    Ok(db)
}

/// 掩码数据库 URL 中的密码
fn mask_db_url(url: &str) -> String {
    if let Some(idx) = url.find("://") {
        if let Some(at) = url[idx + 3..].find('@') {
            let prefix = &url[..idx + 3];
            let suffix = &url[idx + 3 + at..];
            return format!("{}***{}", prefix, suffix);
        }
    }
    url.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_init_sqlite_memory() {
        let config = DbConfig::default();
        let db = init_db(&config).await.expect("Failed to init db");
        // 验证连接可用
        let _ = db.ping().await.expect("Failed to ping db");
    }

    #[test]
    fn test_mask_db_url() {
        assert_eq!(
            mask_db_url("mysql://user:pass@localhost/db"),
            "mysql://***@localhost/db"
        );
        assert_eq!(
            mask_db_url("sqlite:./data.db"),
            "sqlite:./data.db"
        );
    }
}
