/// 数据库迁移管理 API（启动/取消/查询迁移状态）
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use db::{
    entities::{migration_run, migration_table},
    migration::{
        execute, preflight, MigrationMode, MigrationOptions, MigrationRunStatus,
        update_migration_status,
    },
};

use crate::AppState;
use chrono::Utc;

// ===== 响应类型 =====

#[derive(Debug, Serialize)]
pub struct MigrationStatusResponse {
    /// 是否有正在运行的迁移任务
    pub has_active: bool,
    /// 最近一次迁移记录（若有）
    pub latest_run: Option<MigrationRunInfo>,
}

/// 迁移运行摘要（字段来自 migration_run::Model）
#[derive(Debug, Serialize)]
pub struct MigrationRunInfo {
    pub run_id: String,
    pub status: String,
    /// 源库哈希（不含凭据）
    pub source_identity_hash: String,
    /// 目标库哈希（不含凭据）
    pub target_identity_hash: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub created_at: String,
    /// 该运行下的表迁移行数（从 migration_table 汇总）
    pub tables_total: usize,
    pub tables_done: usize,
    pub tables_failed: usize,
}

/// 表级迁移进度（字段来自 migration_table::Model）
#[derive(Debug, Serialize)]
pub struct MigrationTableInfo {
    pub id: i64,
    pub run_id: String,
    pub source_table: String,
    pub target_table: String,
    pub mode: String,
    pub status: String,
    pub rows_read: i64,
    pub rows_written: i64,
    pub error_kind: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct MigrationTablesResponse {
    pub run_id: String,
    pub tables: Vec<MigrationTableInfo>,
}

// ===== 请求类型 =====

#[derive(Debug, Deserialize)]
pub struct StartMigrationRequest {
    /// 源数据库 URL（必须是 mysql:// 协议）
    pub source_db_url: String,
    /// 迁移模式：dry_run（默认，只预检不写入）或 apply（实际迁移）
    #[serde(default = "default_mode")]
    pub mode: String,
    /// 每批复制行数（默认 500）
    #[serde(default = "default_batch_size")]
    pub batch_size: u32,
    /// 要迁移的表名列表（必须非空，且每个表名只含字母/数字/下划线）
    pub tables: Vec<String>,
    /// 可选的运行 ID（字母/数字/短横线/下划线）
    pub run_id: Option<String>,
}

fn default_mode() -> String { "dry_run".to_string() }
fn default_batch_size() -> u32 { 500 }

// ===== 路由处理函数 =====

/// GET /api/v2/migration/status — 查询最近一次迁移状态
pub async fn get_migration_status(
    State(state): State<AppState>,
) -> Result<Json<MigrationStatusResponse>, (StatusCode, String)> {
    // 按 started_at 倒序找最新一条运行记录
    let latest = migration_run::Entity::find()
        .order_by_desc(migration_run::Column::StartedAt)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("查询迁移记录失败: {}", e)))?;

    let run_info = if let Some(run) = latest {
        // 查询该运行下的所有表进度
        let tables = migration_table::Entity::find()
            .filter(migration_table::Column::RunId.eq(&run.run_id))
            .all(&state.db)
            .await
            .unwrap_or_default();

        let tables_total = tables.len();
        let tables_done = tables.iter().filter(|t| t.status == "completed").count();
        let tables_failed = tables.iter().filter(|t| t.status == "failed").count();

        // 判断是否活跃
        let is_active = matches!(run.status.as_str(), "started" | "in_progress");

        Some((is_active, MigrationRunInfo {
            run_id: run.run_id.clone(),
            status: run.status.clone(),
            source_identity_hash: run.source_identity_hash.clone(),
            target_identity_hash: run.target_identity_hash.clone(),
            started_at: run.started_at.to_string(),
            finished_at: run.finished_at.map(|t| t.to_string()),
            created_at: run.created_at.to_string(),
            tables_total,
            tables_done,
            tables_failed,
        }))
    } else {
        None
    };

    let (has_active, run_info) = match run_info {
        Some((active, info)) => (active, Some(info)),
        None => (false, None),
    };

    Ok(Json(MigrationStatusResponse { has_active, latest_run: run_info }))
}

/// POST /api/v2/migration/start — 启动迁移（干运行或实际迁移）
pub async fn start_migration(
    State(state): State<AppState>,
    Json(req): Json<StartMigrationRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // 验证迁移模式
    let migration_mode = match req.mode.to_lowercase().as_str() {
        "dry_run" | "dryrun" | "dry-run" => MigrationMode::DryRun,
        "apply" => MigrationMode::Apply,
        other => return Err((StatusCode::BAD_REQUEST, format!("不支持的迁移模式: {}", other))),
    };

    // 构建目标 DB URL（即当前 Rust 实例的数据库）
    let target_url = std::env::var("DATABASE_URL")
        .or_else(|_| {
            // 尝试从 MYSQL_* 环境变量拼装
            if let Ok(host) = std::env::var("MYSQL_HOST") {
                let port = std::env::var("MYSQL_PORT").unwrap_or_else(|_| "3306".to_string());
                let db_name = std::env::var("MYSQL_DATABASE").unwrap_or_else(|_| "data_center".to_string());
                let user = std::env::var("MYSQL_USER").unwrap_or_else(|_| "root".to_string());
                let pass = std::env::var("MYSQL_PASSWORD").unwrap_or_default();
                Ok(format!("mysql://{}:{}@{}:{}/{}", user, pass, host, port, db_name))
            } else {
                Err(std::env::VarError::NotPresent)
            }
        })
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "未找到目标数据库配置".to_string()))?;

    // 构建迁移选项
    let allowed_tables = if req.tables.is_empty() {
        None // 空列表 = 迁移全部表
    } else {
        let mut set = BTreeSet::new();
        for t in &req.tables {
            set.insert(t.clone());
        }
        Some(set)
    };

    let opts = MigrationOptions {
        source_url: req.source_db_url.clone(),
        target_url: target_url.clone(),
        mode: migration_mode,
        batch_size: req.batch_size,
        allowed_tables,
        run_id: req.run_id.clone(),
    };

    // 参数校验
    opts.validate()
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("迁移参数校验失败: {}", e)))?;

    // 先执行 preflight 检查（只读，检测连通性和表结构）
    let report = preflight(&opts).await
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("迁移预检失败: {}", e)))?;

    // 准备响应的 run_id（优先使用 opts 中的，其次生成一个基于时间戳的 ID）
    let run_id_for_response = opts.run_id.clone()
        .unwrap_or_else(|| format!("migration-{}", Utc::now().timestamp()));

    // 在后台任务中运行迁移（不阻塞 HTTP 响应）
    let spawn_run_id = run_id_for_response.clone();
    tokio::spawn(async move {
        match execute(&opts).await {
            Ok(r) => tracing::info!("迁移任务 {} 完成，源表 {} 张", spawn_run_id, r.source_table_count),
            Err(e) => tracing::error!("迁移任务 {} 失败: {}", spawn_run_id, e),
        }
    });

    let mode_label = if matches!(migration_mode, MigrationMode::DryRun) {
        "预检（不写入数据）"
    } else {
        "实际迁移"
    };

    Ok(Json(serde_json::json!({
        "success": true,
        "message": format!("迁移任务已启动（{}），共 {} 张表", mode_label, req.tables.len()),
        "run_id": run_id_for_response,
        "source_tables_found": report.source_table_count,
        "selected_tables": report.selected_tables,
        "source_dialect": report.source_dialect,
        "target_dialect": report.target_dialect,
    })))
}

/// POST /api/v2/migration/cancel — 取消当前迁移
pub async fn cancel_migration(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // 按 started_at 倒序找最新活跃的运行记录
    let latest = migration_run::Entity::find()
        .order_by_desc(migration_run::Column::StartedAt)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("查询迁移记录失败: {}", e)))?;

    let run = latest
        .ok_or((StatusCode::NOT_FOUND, "当前没有迁移记录".to_string()))?;

    if !matches!(run.status.as_str(), "started" | "in_progress") {
        return Err((StatusCode::BAD_REQUEST,
            format!("当前迁移状态为 {}，无法取消", run.status)));
    }

    // 标记为已取消
    update_migration_status(&state.db, &run.run_id, MigrationRunStatus::Cancelled).await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("取消迁移失败: {}", e)))?;

    Ok(Json(serde_json::json!({
        "success": true,
        "run_id": run.run_id,
        "message": "迁移任务已标记为取消（当前批次处理完毕后停止）"
    })))
}

/// GET /api/v2/migration/tables/:run_id — 查询指定运行的表级进度
pub async fn get_migration_tables(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<MigrationTablesResponse>, (StatusCode, String)> {
    let tables = migration_table::Entity::find()
        .filter(migration_table::Column::RunId.eq(&run_id))
        .order_by_asc(migration_table::Column::Id)
        .all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("查询表进度失败: {}", e)))?;

    let table_infos = tables.into_iter().map(|t| MigrationTableInfo {
        id: t.id,
        run_id: t.run_id,
        source_table: t.source_table,
        target_table: t.target_table,
        mode: t.mode,
        status: t.status,
        rows_read: t.rows_read,
        rows_written: t.rows_written,
        error_kind: t.error_kind,
        created_at: t.created_at.to_string(),
        updated_at: t.updated_at.to_string(),
    }).collect();

    Ok(Json(MigrationTablesResponse { run_id, tables: table_infos }))
}

/// GET /api/v2/migration/runs — 列出所有迁移运行记录（最近 50 条）
pub async fn list_migration_runs(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let runs = migration_run::Entity::find()
        .order_by_desc(migration_run::Column::StartedAt)
        .all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("查询迁移记录失败: {}", e)))?;

    let items: Vec<serde_json::Value> = runs.into_iter().map(|r| {
        serde_json::json!({
            "run_id": r.run_id,
            "status": r.status,
            "source_identity_hash": r.source_identity_hash,
            "target_identity_hash": r.target_identity_hash,
            "started_at": r.started_at.to_string(),
            "finished_at": r.finished_at.map(|t| t.to_string()),
        })
    }).collect();

    Ok(Json(serde_json::json!({ "runs": items, "total": items.len() })))
}
