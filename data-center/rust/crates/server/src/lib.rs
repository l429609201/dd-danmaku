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
// 管理前端静态资源与 SPA 页面路由。
mod web_ui;
mod api;
mod bridge;
mod cache_service;
// 按当前规范化表结构摄取与拼装上游媒体实体。
mod entity_service;
// 官方目录扩展字段独立规范化存储。
pub mod catalog_fields;
// 匹配与弹幕协议采用独立字段表，避免响应原文作为业务事实来源。
pub mod structured_response_store;
// 统一官方上游签名，凭据不与旧版不同结构的密钥表混用。
pub mod dandanplay_upstream;
// 专用加密配置服务，供后台更新和请求时签名共享。
pub mod upstream_config;
mod match_service;
mod http_client;
pub mod auth;
mod run_mode;
mod router_modes;
mod redis_service;
mod geoip_service;
mod alias_ai_service;
// Worker 模式出站控制客户端（对应 Python control_client.py）
pub mod control_client;

pub use cache_service::{CacheService, CacheGetOptions, CachedResponse};
pub use bridge::ConnectionManager;
pub use match_service::{VideoMatchService, MatchQuery, MatchedItem};
pub use http_client::{SimpleHttpClient, HttpError};
pub use run_mode::RunMode;
pub use redis_service::RedisCacheService;
pub use geoip_service::{GeoIpService, GeoDistributionResponse};
pub use alias_ai_service::{AliasAiService, ScoringResult, ScoringStatus};

// 导出主要的公共函数和类型

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

/// 允许旧 handler 继续使用 `State<Arc<AppState>>` 提取器。
/// AppState 字段均为 Arc/连接池句柄，克隆开销很小。
impl axum::extract::FromRef<AppState> for Arc<AppState> {
    fn from_ref(state: &AppState) -> Self {
        Arc::new(state.clone())
    }
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

/// 创建应用路由
pub fn create_router(state: AppState) -> Router {
    let run_mode = state.run_mode;
    
    // ========== 核心路由（两种模式都启用） ==========
    
    // Admin API 路由（Control Node/Message/Event 管理）
    let admin_routes = Router::new()
        .route("/health", get(health::health_check))
        .route("/nodes", get(api::admin::list_nodes).post(api::admin::upsert_node))
        .route("/nodes/{id}", get(api::admin::get_node))
        .route("/messages", get(api::admin::list_messages))
        .route("/messages/{id}", get(api::admin::get_message))
        .route("/events", get(api::admin::list_events))
        .route("/events/errors", get(api::admin::recent_errors))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));
    
    // Worker Bridge WebSocket 路由（两种模式都需要）
    let bridge_routes = Router::new()
        .route("/worker", get(bridge::ws_handler));
    
    // ========== 根据运行模式选择性启用路由 ==========
    
    // 前端不依赖运行模式，API 鉴权仍由各 API 路由负责。
    let web_directory = web_ui::directory();
    let web_fallback = axum::routing::any(web_ui::serve).with_state(web_directory.clone());
    info!(directory = %web_directory.display(), "🖥️ 管理 UI 静态资源已挂载");
    let mut router = Router::new()
        .fallback_service(web_fallback)
        .route("/health", get(health::health_check))
        .nest("/api/admin", admin_routes)
        .nest("/api/ws", bridge_routes)
        // Worker/API 两种模式均提供登录及完整后台管理接口，仍保留 JWT 鉴权。
        .merge(router_modes::create_management_routes(&state));
    
    match run_mode {
        RunMode::Worker => {
            // Worker 模式只关闭公共弹幕接口，不关闭后台登录和配置管理。
            info!("🔧 运行模式：Worker - CloudFlare 数据中心");
            info!("✅ 启用：管理后台、登录认证、Admin API、Worker Bridge");
            info!("ℹ️ 未启用独立 dandanplay 公共接口");
        },
        RunMode::Api => {
            // API 模式：启用完整的弹幕服务和管理后台
            info!("🌐 运行模式：API - 独立弹幕服务端");
            info!("✅ 启用：dandanplay API、OAuth、完整管理后台");
            
            // 公共弹幕接口仅在 API 模式下添加，后台管理接口已在共享路由中注册。
            router = router.merge(router_modes::create_dandanplay_routes());
        }
    }
    
    router
        .layer(CorsLayer::permissive())
        .with_state(state)
}

/// 用户表为空时初始化管理员；未指定密码则生成随机密码，仅创建成功后输出一次。
pub async fn init_admin_from_env(db: &sea_orm::DatabaseConnection) -> anyhow::Result<()> {
    // 已有账户时不生成、不输出密码，也不覆盖数据库中的账户。
    if db::UserRepo::count(db).await? > 0 {
        info!("👤 用户表已有账户，跳过初始管理员创建");
        return Ok(());
    }
    // 明确记录空表触发初始化，再检查环境配置，避免启动日志缺少阶段信息。
    info!("👤 app_users 为空，开始初始化管理员");
    let username = std::env::var("ADMIN_USERNAME").unwrap_or_default().trim().to_string();
    if username.is_empty() {
        tracing::warn!("⚠️ 用户表为空且未配置 ADMIN_USERNAME，跳过初始管理员创建");
        return Ok(());
    }
    let configured_password = std::env::var("ADMIN_PASSWORD").unwrap_or_default();
    let generated = configured_password.is_empty();
    let password = if generated {
        // 使用系统安全随机源生成 192 位随机密码，不使用时间戳或普通伪随机数。
        use base64::Engine;
        use ring::rand::SecureRandom;
        let mut bytes = [0u8; 24];
        ring::rand::SystemRandom::new().fill(&mut bytes)
            .map_err(|_| anyhow::anyhow!("生成初始管理员随机密码失败"))?;
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    } else {
        configured_password
    };
    let hash = auth::PasswordService::hash_password(&password)?;
    db::UserRepo::create(db, username.clone(), hash, None, None, "admin".to_string()).await?;
    info!("👤 已创建初始管理员: {}", username);
    // 按用户要求显示自动生成的初始密码；显式配置的密码不写入日志。
    if generated {
        tracing::warn!("🔑 初始管理员随机密码: {}（仅本次创建时显示，请妥善保存并登录后修改密码）", password);
    }
    Ok(())
}

/// 启动服务器
pub async fn run_server(
    db: sea_orm::DatabaseConnection,
    addr: &str,
) -> anyhow::Result<()> {
    // 缓存与控制通道共用同一 Redis 实例，SQL 保留冷备。
    let redis = Arc::new(RedisCacheService::new().await);
    let cache = Arc::new(CacheService::new(db.clone()).with_redis(redis.clone()));
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

    // Worker 模式：配置了 CONTROL_WORKER_WS_URL 时主动连接 Worker 控制通道
    if state.run_mode.is_worker() {
        match control_client::ControlConfig::from_env() {
            Some(cfg) => {
                info!("🔗 启动控制客户端: node_id={}", cfg.node_id);
                control_client::ControlClient::new(cfg, state.clone()).spawn();
            }
            None => info!("ℹ️ 未配置 CONTROL_WORKER_WS_URL，控制客户端未启动"),
        }
    }

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
