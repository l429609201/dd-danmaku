//! 数据库管理统计：仅统计固定业务实体，不推测容量、连接池或 Redis 性能。
use axum::{extract::State, http::StatusCode, routing::get, Json, Router};
use sea_orm::{ConnectionTrait, DbBackend, EntityName, EntityTrait, PaginatorTrait};
use serde_json::{json, Value};

use crate::AppState;

type ApiResult = Result<Json<Value>, (StatusCode, Json<Value>)>;

/// 调用方必须在 /api/v2 下挂载 JWT 与管理员权限中间件。
pub fn routes() -> Router<AppState> {
    Router::new().route("/dashboard/db-stats", get(stats))
}

async fn stats(State(state): State<AppState>) -> ApiResult {
    let dialect = match state.db.get_database_backend() {
        DbBackend::Sqlite => "sqlite",
        DbBackend::Postgres => "postgresql",
        DbBackend::MySql => "mysql",
    };
    let mut tables = Vec::new();
    // 编译期固定实体白名单，由 SeaORM 按实际方言生成 COUNT；不接受用户表名。
    // 任一表缺失或查询失败即整体失败，禁止把未知行数伪装为 0。
    macro_rules! count_tables {
        ($($entity:ident),+ $(,)?) => {
            $(
                let entity = db::entities::$entity::Entity;
                let row_count = db::entities::$entity::Entity::find()
                    .count(&state.db).await.map_err(|_| {
                        // 不把驱动错误、SQL、连接地址或凭据暴露到响应或诊断日志。
                        tracing::error!(table = entity.table_name(), "数据库表统计失败");
                        (StatusCode::INTERNAL_SERVER_ERROR,
                            Json(json!({"message": "数据库表统计失败"})))
                    })?;
                tables.push(json!({
                    "name": entity.table_name(), "row_count": row_count,
                    "size_bytes": null, "size_ratio": null, "forecast_available": false
                }));
            )+
        };
    }
    count_tables!(
        control_node, control_message, runtime_event, api_response_cache, api_response_entity,
        episode_link, anime, season, bangumi_version, bangumi_season, bangumi_episode_member,
        bangumi_title, catalog_search_result, catalog_search_member, catalog_fields,
        catalog_metadata, catalog_rating_detail, catalog_relation, catalog_tag, catalog_trailer,
        episode, anime_external_id, anime_alias, config, config_secret, app_user, app_user_session,
        app_user_api_token, migration_run, migration_table, legacy_import_row, local_comment_store,
        structured_response, structured_match, structured_comment, ip_rule, ua_rule, api_key_pool,
        sign_key_pool, user_allow_pool, oauth_config, worker_log, ip_stats, cleanup_policy,
    );
    // table_count 是固定业务实体表数量，不声称包含数据库内部表或外部扩展表。
    Ok(Json(json!({
        "sql": {"dialect": dialect, "table_count": tables.len(), "total_size_bytes": null,
            "pool": null, "tables": tables},
        "redis": {"enabled": state.redis.is_enabled(), "error": "尚未采集Redis指标"},
        "engine_perf": {"available": false, "note": "尚未采集"}
    })))
}
