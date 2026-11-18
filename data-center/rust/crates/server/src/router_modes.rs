use axum::Router;

use crate::{AppState, api, auth};
use axum::{routing::{get, post, put, delete}, middleware};

/// 两种运行模式共享管理后台；模式只控制对外弹幕业务接口，不绕过后台鉴权。
pub fn create_management_routes(state: &AppState) -> Router<AppState> {
    // 认证 API 路由（公开，无需认证）
    let auth_protected = Router::new()
        .route("/me", get(api::auth::get_me))
        .route("/change-password", post(api::auth::change_password))
        .route("/refresh", post(api::auth::refresh_token))
        // 登出同样验证有效会话，避免无效令牌进入数据库操作。
        .route("/logout", post(api::auth::logout))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));
    let auth_routes = Router::new()
        .route("/login", post(api::auth::login))
        .merge(auth_protected);
    
    // 用户管理 API 路由（需要认证）
    let users_routes = Router::new()
        .route("/", get(api::users::get_users).post(api::users::create_user))
        .route("/{id}", get(api::users::get_user).put(api::users::update_user).delete(api::users::delete_user))
        .route("/{id}/reset-password", post(api::users::reset_user_password))
        .route("/{user_id}/tokens", get(api::users::get_user_tokens))
        .route("/{user_id}/tokens", post(api::users::create_user_token))
        .route("/{user_id}/tokens/{token_id}", delete(api::users::delete_user_token))
        .route_layer(middleware::from_fn(auth::admin_middleware))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));
    
    // 系统设置 API 路由（需要认证）
    let settings_routes = Router::new()
        .route("/", get(api::settings::get_config).put(api::settings::update_config))
        .route("/dandanplay", get(api::settings::get_dandanplay_config).put(api::settings::put_dandanplay_config))
        .route("/database", get(api::settings::get_database_config))
        .route("/cache", get(api::settings::get_cache_config))
        .route("/health", get(api::settings::health_check))
        .route_layer(middleware::from_fn(auth::admin_middleware))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));
    
    // Dashboard API 路由（需要认证）
    let dashboard_routes = Router::new()
        .route("/stats", get(api::dashboard::get_dashboard_stats))
        .route("/system", get(api::dashboard::get_system_info))
        .route_layer(middleware::from_fn(auth::admin_middleware))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));
    
    // 媒体库管理 API 路由（需要认证）
    let media_routes = Router::new()
        .route("/animes", get(api::media::get_animes).post(api::media::create_anime))
        .route("/animes/search", get(api::media::search_animes))
        .route("/animes/{id}", get(api::media::get_anime).put(api::media::update_anime).delete(api::media::delete_anime))
        .route("/episodes", get(api::media::get_episodes).post(api::media::create_episode))
        .route("/episodes/by-anime", get(api::media::get_anime_episodes))
        .route("/episodes/{id}", get(api::media::get_episode).put(api::media::update_episode).delete(api::media::delete_episode))
        .route_layer(middleware::from_fn(auth::admin_middleware))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));
    
    // 规则管理 API 路由（需要认证）
    let rules_routes = Router::new()
        .route("/ip-rules", get(api::rules::get_ip_rules).post(api::rules::create_ip_rule))
        .route("/ip-rules/batch", post(api::rules::batch_ip_rules))
        .route("/ip-rules/{id}", get(api::rules::get_ip_rule).put(api::rules::update_ip_rule).delete(api::rules::delete_ip_rule))
        .route("/ua-rules", get(api::rules::get_ua_rules).post(api::rules::create_ua_rule))
        .route("/ua-rules/batch", post(api::rules::batch_ua_rules))
        .route("/ua-rules/{id}", get(api::rules::get_ua_rule).put(api::rules::update_ua_rule).delete(api::rules::delete_ua_rule))
        .route_layer(middleware::from_fn(auth::admin_middleware))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));
    
    // 密钥和安全管理 API 路由（需要认证）
    let keys_routes = Router::new()
        .route("/api-keys", get(api::keys::get_api_keys).post(api::keys::create_api_key))
        .route("/api-keys/{id}", put(api::keys::update_api_key).delete(api::keys::delete_api_key))
        .route("/sign-keys", get(api::keys::get_sign_keys).post(api::keys::create_sign_key))
        .route("/sign-keys/{id}", put(api::keys::update_sign_key).delete(api::keys::delete_sign_key))
        .route("/user-allows", get(api::keys::get_user_allows).post(api::keys::create_user_allow))
        .route("/user-allows/{id}", put(api::keys::update_user_allow).delete(api::keys::delete_user_allow))
        .route("/oauth-configs", get(api::keys::get_oauth_configs).post(api::keys::create_oauth_config))
        .route("/oauth-configs/{id}", put(api::keys::update_oauth_config).delete(api::keys::delete_oauth_config))
        .route_layer(middleware::from_fn(auth::admin_middleware))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));
    
    // 日志和监控 API 路由（需要认证）
    let logs_routes = Router::new()
        .route("/worker-logs", get(api::keys::get_worker_logs))
        .route("/ip-stats", get(api::keys::get_ip_stats))
        .route("/ip-stats/top", get(api::keys::get_top_ips))
        // 服务器日志文件（只读，读取 CONFIG_PATH/logs/*.log）
        .route("/server-files", get(api::server_logs::list_server_log_files))
        .route("/server-logs", get(api::server_logs::get_server_logs))
        .route("/server-logs/stream", get(api::server_logs::stream_server_logs))
        .route_layer(middleware::from_fn(auth::admin_middleware))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));

    // 数据库迁移管理 API 路由（需要认证）
    let migration_routes = Router::new()
        .route("/status", get(api::migration_api::get_migration_status))
        .route("/runs", get(api::migration_api::list_migration_runs))
        .route("/start", post(api::migration_api::start_migration))
        .route("/cancel", post(api::migration_api::cancel_migration))
        .route("/{run_id}/tables", get(api::migration_api::get_migration_tables))
        .route_layer(middleware::from_fn(auth::admin_middleware))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));
    
    // 数据清理 API 路由（需要认证）
    let cleanup_routes = Router::new()
        .route("/policies", get(api::keys::get_cleanup_policies).post(api::keys::create_cleanup_policy))
        .route("/policies/{id}", put(api::keys::update_cleanup_policy).delete(api::keys::delete_cleanup_policy))
        .route("/execute", post(api::keys::execute_cleanup))
        .route_layer(middleware::from_fn(auth::admin_middleware))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));
    
    // GeoIP 地理分布 API（需要认证）
    let geoip_routes = Router::new()
        .route("/geo-distribution", get(api::geoip_api::get_geo_distribution))
        .route_layer(middleware::from_fn(auth::admin_middleware))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));
    
    // 别名 AI 辅助 API（需要认证）
    let alias_ai_routes = Router::new()
        .route("/ai-score", post(api::alias_ai_api::start_ai_scoring))
        .route("/ai-status", get(api::alias_ai_api::get_ai_scoring_status))
        .route_layer(middleware::from_fn(auth::admin_middleware))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));
    
    // 新增管理能力与既有 UI 保持路径一致，并统一执行会话和角色校验。
    let ui_routes = api::cache_admin::routes()
        .merge(api::comment_admin::router())
        .merge(api::episode_links_admin::routes())
        .merge(api::db_stats::routes())
        .merge(api::media_admin::routes())
        .merge(api::entities_admin::routes())
        .route_layer(middleware::from_fn(auth::admin_middleware))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::auth_middleware));

    Router::new()
        .nest("/api/v2", ui_routes)
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
        .nest("/api/v2/migration", migration_routes)
}

/// 仅 API 模式开放的公共弹幕接口，与管理后台路由分离。
pub fn create_dandanplay_routes() -> Router<AppState> {
    Router::new().nest(
        "/api/v2",
        Router::new()
            .route("/search/episodes", get(api::dandanplay::search_episodes))
            .route("/search/anime", get(api::dandanplay::search_anime))
            .route("/bangumi/{id}", get(api::dandanplay::get_bangumi))
            .route("/match", post(api::dandanplay::match_video))
            .route("/comment/{episode_id}", get(api::dandanplay::get_comments))
            .route("/extcomment", get(api::dandanplay::get_ext_comments_query).post(api::dandanplay::get_ext_comments)),
    )
}
