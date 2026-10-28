use axum::{
    extract::State,
    http::StatusCode,
    Json,
};
use db::{entities::*, ControlNodeRepo, ControlMessageRepo, RuntimeEventRepo, CacheRepo};
use sea_orm::{EntityTrait, PaginatorTrait};
use crate::AppState;
use crate::api::settings::models::*;

/// 获取 Dashboard 统计
pub async fn get_dashboard_stats(
    State(state): State<AppState>,
) -> Result<Json<DashboardStats>, (StatusCode, String)> {
    // 系统统计
    let system_stats = SystemStats {
        version: env!("CARGO_PKG_VERSION").to_string(),
        rust_version: "1.83".to_string(),
        build_time: "2024-01-01".to_string(), // 可以从编译时间获取
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        cpu_usage: None, // 需要额外的系统库
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
    
    let danmaku_stats = DanmakuStats {
        total_episodes,
        total_comments: 0, // 需要从文件统计
        total_size_mb: 0.0,
    };
    
    // 计算 uptime（从程序启动到现在）
    let uptime_seconds = 0; // 需要在 AppState 中记录启动时间
    
    Ok(Json(DashboardStats {
        system: system_stats,
        worker: worker_stats,
        cache: cache_stats,
        danmaku: danmaku_stats,
        uptime_seconds,
    }))
}

/// 系统信息
#[derive(serde::Serialize)]
pub struct SystemInfo {
    pub version: String,
    pub rust_version: String,
    pub os: String,
    pub arch: String,
    pub uptime_seconds: u64,
}

pub async fn get_system_info(
    State(_state): State<AppState>,
) -> Result<Json<SystemInfo>, (StatusCode, String)> {
    Ok(Json(SystemInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        rust_version: "1.83".to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        uptime_seconds: 0,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_system_info() {
        let info = SystemInfo {
            version: "0.1.0".to_string(),
            rust_version: "1.83".to_string(),
            os: "linux".to_string(),
            arch: "x86_64".to_string(),
            uptime_seconds: 3600,
        };
        
        assert_eq!(info.version, "0.1.0");
        assert_eq!(info.uptime_seconds, 3600);
    }
}
