use axum::Router;
use std::sync::Arc;

use crate::{AppState, RunMode, api, auth, bridge, health};
use axum::{routing::{get, post, put, delete}, middleware};
use tracing::info;

/// 创建 API 模式的完整路由（dandanplay + 管理后台）
pub fn create_api_mode_routes(state: &AppState) -> Router<AppState> {
    // 认证 API 路由（公开，无需认证）
    let auth_protected = Router::new()
        .route("/me", get(api::auth::get_me))
        .route("/change-password", post(api::auth::change_password))
        .route("/refresh", post(api::auth::refresh_token))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));
    let auth_routes = Router::new()
        .route("/login", post(api::auth::login))
        .route("/logout", post(api::auth::logout))
        .merge(auth_protected);
    
    // 用户管理 API 路由（需要认证）
    let users_routes = Router::new()
        .route("/", get(api::users::get_users).post(api::users::create_user))
        .route("/{id}", get(api::users::get_user).put(api::users::update_user).delete(api::users::delete_user))
        .route("/{id}/reset-password", post(api::users::reset_user_password))
        .route("/{user_id}/tokens", get(api::users::get_user_tokens))
        .route("/{user_id}/tokens", post(api::users::create_user_token))
        .route("/{user_id}/tokens/{token_id}", delete(api::users::delete_user_token))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));
    
    // 系统设置 API 路由（需要认证）
    let settings_routes = Router::new()
        .route("/", get(api::settings::get_config).put(api::settings::update_config))
        .route("/database", get(api::settings::get_database_config))
        .route("/cache", get(api::settings::get_cache_config))
        .route("/health", get(api::settings::health_check))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));
    
    // Dashboard API 路由（需要认证）
    let dashboard_routes = Router::new()
        .route("/stats", get(api::dashboard::get_dashboard_stats))
        .route("/system", get(api::dashboard::get_system_info))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));
    
    // 媒体库管理 API 路由（需要认证）
    let media_routes = Router::new()
        .route("/animes", get(api::media::get_animes).post(api::media::create_anime))
        .route("/animes/search", get(api::media::search_animes))
        .route("/animes/{id}", get(api::media::get_anime).put(api::media::update_anime).delete(api::media::delete_anime))
        .route("/episodes", get(api::media::get_episodes).post(api::media::create_episode))
        .route("/episodes/by-anime", get(api::media::get_anime_episodes))
        .route("/episodes/{id}", get(api::media::get_episode).put(api::media::update_episode).delete(api::media::delete_episode))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));
    
    // 规则管理 API 路由（需要认证）
    let rules_routes = Router::new()
        .route("/ip-rules", get(api::rules::get_ip_rules).post(api::rules::create_ip_rule))
        .route("/ip-rules/batch", post(api::rules::batch_ip_rules))
        .route("/ip-rules/{id}", get(api::rules::get_ip_rule).put(api::rules::update_ip_rule).delete(api::rules::delete_ip_rule))
        .route("/ua-rules", get(api::rules::get_ua_rules).post(api::rules::create_ua_rule))
        .route("/ua-rules/batch", post(api::rules::batch_ua_rules))
        .route("/ua-rules/{id}", get(api::rules::get_ua_rule).put(api::rules::update_ua_rule).delete(api::rules::delete_ua_rule))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));
    
    // 密钥和安全管理 API 路由（需要认证）
    let keys_routes = Router::new()
        .route("/api-keys", get(api::keys::get_api_keys).post(api::keys::create_api_key))
        .route("/api-keys/{id}", put(api::keys::update_api_key).delete(api::keys::delete_api_key))
        .route("/sign-keys", get(api::keys::get_sign_keys).post(api::keys::create_sign_key))
        .route("/sign-keys/{id}", delete(api::keys::delete_sign_key))
        .route("/user-allows", get(api::keys::get_user_allows).post(api::keys::create_user_allow))
        .route("/user-allows/{id}", delete(api::keys::delete_user_allow))
        .route("/oauth-configs", get(api::keys::get_oauth_configs).post(api::keys::create_oauth_config))
        .route("/oauth-configs/{id}", delete(api::keys::delete_oauth_config))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));
    
    // 日志和监控 API 路由（需要认证）
    let logs_routes = Router::new()
        .route("/worker-logs", get(api::keys::get_worker_logs))
        .route("/ip-stats", get(api::keys::get_ip_stats))
        .route("/ip-stats/top", get(api::keys::get_top_ips))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));
    
    // 数据清理 API 路由（需要认证）
    let cleanup_routes = Router::new()
        .route("/policies", get(api::keys::get_cleanup_policies).post(api::keys::create_cleanup_policy))
        .route("/policies/{id}", delete(api::keys::delete_cleanup_policy))
        .route("/execute", post(api::keys::execute_cleanup))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));
    
    // GeoIP 地理分布 API（需要认证）
    let geoip_routes = Router::new()
        .route("/geo-distribution", get(api::geoip_api::get_geo_distribution))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));
    
    // 别名 AI 辅助 API（需要认证）
    let alias_ai_routes = Router::new()
        .route("/ai-score", post(api::alias_ai_api::start_ai_scoring))
        .route("/ai-status", get(api::alias_ai_api::get_ai_scoring_status))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));
    
    // dandanplay API 路由（公开，无需认证）
    let dandanplay_routes = Router::new()
        .route("/match", post(api::dandanplay::match_video))
        .route("/comment/{episode_id}", get(api::dandanplay::get_comments))
        .route("/extcomment", post(api::dandanplay::get_ext_comments));
    
    Router::new()
        .nest("/api/v2/auth", auth_routes)
        .nest("/api/v2/users", users_routes)
        .nest("/api/v2/settings", settings_routes)
        .nest("/api/v2/dashboard", dashboard_routes)
        .nest("/api/v2/media", media_routes)
        .nest("/api/v2/rules", rules_routes)
        .nest("/api/v2/keys", keys_routes)
        .nest("/api/v2/logs", logs_routes.merge(geoip_routes))
        .nest("/api/v2/cleanup", cleanup_routes)
        .nest("/api/v2/media/aliases", alias_ai_routes)
        .nest("/api/v2", dandanplay_routes)
}

/// 创建 Worker 模式的路由（只有 CF 交互 API）
pub fn create_worker_mode_routes(_state: &AppState) -> Router<AppState> {
    // Worker 模式下不需要额外路由
    // 只保留核心的 Admin API 和 Worker Bridge
    Router::new()
}
