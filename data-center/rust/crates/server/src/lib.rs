use axum::{
    routing::get,
    routing::post,
    routing::put,
    routing::delete,
    Router,
    middleware,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tracing::info;

mod health;
mod api;
mod bridge;
mod cache_service;
mod match_service;
mod http_client;
mod auth;
mod run_mode;
mod router_modes;
mod redis_service;
mod geoip_service;
mod alias_ai_service;

pub use cache_service::CacheService;
pub use bridge::ConnectionManager;
pub use match_service::{VideoMatchService, MatchQuery, MatchedItem};
pub use http_client::{SimpleHttpClient, HttpError};
pub use run_mode::RunMode;
pub use redis_service::RedisCacheService;
pub use geoip_service::{GeoIpService, GeoDistributionResponse};
pub use alias_ai_service::{AliasAiService, ScoringResult, ScoringStatus};

/// 应用状态
#[derive(Clone)]
pub struct AppState {
    pub db: sea_orm::DatabaseConnection,
    pub cache: Arc<CacheService>,
    pub bridge_manager: Arc<ConnectionManager>,
    pub match_service: Arc<VideoMatchService>,
    pub comment_store: Arc<db::CommentStoreService>,
    pub dandanplay_client: Arc<api::dandanplay::DandanplayClient>,
    pub jwt: Arc<auth::JwtService>,
    pub run_mode: RunMode,
    pub redis: Arc<RedisCacheService>,
    pub geoip: Arc<GeoIpService>,
    pub alias_ai: Arc<AliasAiService>,
}

impl AppState {
    /// 创建测试用的 AppState（使用临时目录存储弹幕）
    pub fn new_for_test(db: sea_orm::DatabaseConnection) -> Self {
        let temp_dir = std::env::temp_dir().join("danmaku_test");
        Self {
            cache: Arc::new(CacheService::new(db.clone())),
            bridge_manager: Arc::new(ConnectionManager::new(30, 90)),
            match_service: Arc::new(VideoMatchService::new(db.clone())),
            comment_store: Arc::new(db::CommentStoreService::new(db.clone(), temp_dir)),
            dandanplay_client: Arc::new(api::dandanplay::DandanplayClient::new()),
            jwt: Arc::new(auth::JwtService::new("test_secret_key".to_string(), 24)),
            run_mode: RunMode::Worker,
            redis: Arc::new(RedisCacheService::new_sync()), // 同步创建（禁用状态）
            geoip: Arc::new(GeoIpService::new()),
            alias_ai: Arc::new(AliasAiService::new()),
            db,
        }
    }
}

/// 健康检查响应
#[derive(Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub database: String,
}

/// 根路由处理器
async fn root() -> &'static str {
    "data-center Rust backend"
}

/// 创建应用路由
pub fn create_router(state: AppState) -> Router {
    let run_mode = state.run_mode;
    
    // ========== 核心路由（两种模式都启用） ==========
    
    // Admin API 路由（Control Node/Message/Event 管理）
    let admin_routes = Router::new()
        .route("/health", get(api::admin::health_check))
        .route("/nodes", get(api::admin::list_nodes).post(api::admin::create_node))
        .route("/nodes/{id}", delete(api::admin::delete_node))
        .route("/messages", get(api::admin::list_messages).post(api::admin::create_message))
        .route("/messages/{id}", delete(api::admin::delete_message))
        .route("/events", get(api::admin::list_events))
        .layer(middleware::from_fn_with_state(Arc::new(state.clone()), auth::auth_middleware));
    
    // Worker Bridge WebSocket 路由（两种模式都需要）
    let bridge_routes = Router::new()
        .route("/worker", get(bridge::ws_handler));
    
    // ========== 根据运行模式选择性启用路由 ==========
    
    let mut router = Router::new()
        .route("/", get(root))
        .route("/health", get(health::health_check))
        .nest("/api/admin", admin_routes)
        .nest("/api/ws", bridge_routes);
    
    match run_mode {
        RunMode::Worker => {
            // Worker 模式：只启用与 CF 交互的 API
            info!("🔧 运行模式：Worker - CloudFlare 数据中心");
            info!("✅ 启用：Admin API、Worker Bridge");
            info!("❌ 禁用：dandanplay API、OAuth、管理后台");
            
            // Worker 模式下不添加其他路由
        },
        RunMode::Api => {
            // API 模式：启用完整的弹幕服务和管理后台
            info!("🌐 运行模式：API - 独立弹幕服务端");
            info!("✅ 启用：dandanplay API、OAuth、完整管理后台");
            
            // 使用辅助函数创建 API 模式路由
            let api_routes = router_modes::create_api_mode_routes(&state);
            router = router.merge(api_routes);
        }
    }
    
    router
        .layer(CorsLayer::permissive())
        .with_state(Arc::new(state))
}

/// 启动服务器
pub async fn run_server(
    db: sea_orm::DatabaseConnection,
    addr: &str,
) -> anyhow::Result<()> {
    let cache = Arc::new(CacheService::new(db.clone()));
    let bridge_manager = Arc::new(ConnectionManager::new(30, 90)); // 30s 心跳间隔，90s 超时
    let match_service = Arc::new(VideoMatchService::new(db.clone()));
    
    // 弹幕存储服务（使用环境变量配置路径，默认 /app/config/danmaku）
    let danmaku_dir = std::env::var("DANMAKU_STORE_DIR")
        .unwrap_or_else(|_| "/app/config/danmaku".to_string());
    let comment_store = Arc::new(db::CommentStoreService::new(db.clone(), danmaku_dir));
    
    // JWT 服务（使用环境变量配置密钥，默认测试密钥）
    let jwt_secret = std::env::var("JWT_SECRET")
        .unwrap_or_else(|_| "change_me_in_production_secret_key_1234567890".to_string());
    let jwt_expiry_hours = std::env::var("JWT_EXPIRY_HOURS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(24);
    let jwt = Arc::new(auth::JwtService::new(jwt_secret, jwt_expiry_hours));
    
    // 运行模式（使用环境变量配置，默认 Worker 模式）
    let run_mode = std::env::var("RUN_MODE")
        .ok()
        .and_then(|s| RunMode::from_str(&s))
        .unwrap_or(RunMode::Worker);
    
    // 辅助服务初始化
    let redis = Arc::new(RedisCacheService::new().await);
    let geoip = Arc::new(GeoIpService::new());
    let alias_ai = Arc::new(AliasAiService::new());
    
    info!("========================================");
    info!("🚀 启动 data-center Rust backend");
    info!("📋 运行模式: {}", run_mode.description());
    info!("📦 Redis 缓存: {}", if redis.is_enabled() { "已启用" } else { "未启用" });
    info!("🌍 GeoIP 定位: {}", if geoip.is_available() { "已启用" } else { "未启用" });
    info!("🤖 AI 辅助: 就绪");
    info!("========================================");
    
    let state = AppState { 
        db, 
        cache, 
        bridge_manager, 
        match_service, 
        comment_store,
        dandanplay_client: Arc::new(api::dandanplay::DandanplayClient::new()),
        jwt,
        run_mode,
        redis,
        geoip,
        alias_ai,
    };
    let app = create_router(state);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!("Server listening on {}", addr);

    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_create_router() {
        let config = db::DbConfig::default();
        let db_conn = db::init_db(&config).await.unwrap();
        let state = AppState::new_for_test(db_conn);
        let _router = create_router(state);
    }
}
