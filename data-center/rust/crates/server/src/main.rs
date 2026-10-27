use anyhow::Result;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<()> {
    // 初始化日志
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,sqlx=warn".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Starting data-center Rust backend v{}", env!("CARGO_PKG_VERSION"));

    // 读取数据库配置（简化版，后续从环境变量读取）
    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "sqlite::memory:".to_string());

    let db_config = db::DbConfig {
        url: db_url,
        max_connections: 80,
        min_connections: 10,
        ..Default::default()
    };

    // 初始化数据库连接
    let db = db::init_db(&db_config).await?;

    // 启动服务器
    let addr = std::env::var("LISTEN_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8080".to_string());

    info!("Database initialized, starting server...");
    server::run_server(db, &addr).await?;

    Ok(())
}
