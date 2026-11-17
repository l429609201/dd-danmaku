use axum::{
    extract::State,
    http::StatusCode,
    Json,
};
use db::entities::*;
use sea_orm::{ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QuerySelect};
use crate::AppState;
use crate::api::settings::models::*;

/// 获取 Dashboard 统计
pub async fn get_dashboard_stats(
    State(state): State<AppState>,
) -> Result<Json<DashboardStats>, (StatusCode, String)> {
    // 系统统计
    let system_stats = SystemStats {
        version: env!("CARGO_PKG_VERSION").to_string(),
        rust_version: None,
        // 构建未注入工具链/时间信息，明确返回未知。
        build_time: None,
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        cpu_usage: None,
        memory_used_mb: None,
        memory_total_mb: None,
    };

    // Worker 统计
    let total_nodes = control_node::Entity::find()
        .count(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let online_nodes = state.bridge_manager.connection_count().await as u64;

    let total_messages = control_message::Entity::find()
        .count(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let recent_events = runtime_event::Entity::find()
        .count(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let worker_stats = WorkerStats {
        total_nodes,
        online_nodes,
        total_messages,
        recent_events,
    };

    // 缓存统计
    let total_cache_entries = api_response_cache::Entity::find()
        .count(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let cache_stats = CacheStats {
        total_entries: total_cache_entries,
        hit_rate: None,
        total_size_mb: None,
    };

    // 弹幕统计
    let total_episodes = local_comment_store::Entity::find()
        .count(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // 使用持久化元数据中的真实条数/字节数，不扫描或改写弹幕文件。
    let metadata = local_comment_store::Entity::find().select_only()
        .column_as(local_comment_store::Column::CommentCount.sum(), "comments")
        .column_as(local_comment_store::Column::SizeBytes.sum(), "bytes")
        .into_tuple::<(Option<i64>, Option<i64>)>().one(&state.db).await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "无法读取弹幕存储统计".to_string()))?
        .unwrap_or((None, None));
    let total_comments = metadata.0.unwrap_or(0).max(0) as u64;
    let total_size_bytes = metadata.1.unwrap_or(0).max(0) as u64;
    let danmaku_stats = DanmakuStats {
        total_episodes,
        total_comments,
        total_size_mb: total_size_bytes as f32 / (1024.0 * 1024.0),
    };

    // 媒体库统计：番剧数、剧集数、已审核别名数
    let anime_count = anime::Entity::find()
        .count(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let episode_count = episode::Entity::find()
        .count(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // 只统计 approved 状态的别名，待审核/拒绝不计入
    let alias_count = anime_alias::Entity::find()
        .filter(anime_alias::Column::Status.eq("approved"))
        .count(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let media_stats = MediaStats {
        anime_count,
        episode_count,
        alias_count,
    };

    // 密钥与规则统计
    let api_key_count = api_key_pool::Entity::find()
        .count(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let sign_key_count = sign_key_pool::Entity::find()
        .count(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let ip_rule_count = ip_rule::Entity::find()
        .count(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let ua_rule_count = ua_rule::Entity::find()
        .count(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let keys_rules_stats = KeysRulesStats {
        api_key_count,
        sign_key_count,
        ip_rule_count,
        ua_rule_count,
    };

    // 进程运行时长（秒）
    let uptime_seconds = Some(state.start_time.elapsed().as_secs());

    Ok(Json(DashboardStats {
        system: system_stats,
        worker: worker_stats,
        cache: cache_stats,
        danmaku: danmaku_stats,
        media: media_stats,
        keys_rules: keys_rules_stats,
        uptime_seconds,
    }))
}

/// 系统信息
#[derive(serde::Serialize)]
pub struct SystemInfo {
    pub version: String,
    pub rust_version: Option<String>,
    pub os: String,
    pub arch: String,
    pub uptime_seconds: Option<u64>,
}

pub async fn get_system_info(
    State(state): State<AppState>,
) -> Result<Json<SystemInfo>, (StatusCode, String)> {
    Ok(Json(SystemInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        rust_version: None,
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        uptime_seconds: Some(state.start_time.elapsed().as_secs()),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_system_info() {
        let info = SystemInfo {
            version: "0.1.0".to_string(),
            rust_version: None,
            os: "linux".to_string(),
            arch: "x86_64".to_string(),
            uptime_seconds: Some(3600),
        };

        assert_eq!(info.version, "0.1.0");
        assert_eq!(info.uptime_seconds, Some(3600));
    }
}
