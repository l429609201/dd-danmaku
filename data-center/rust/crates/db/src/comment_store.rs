use anyhow::{Context, Result};
use sea_orm::{DatabaseConnection, EntityTrait, QueryFilter, ColumnTrait, Set, ActiveModelTrait};
use std::path::{Path, PathBuf};
use std::fs;
use serde::{Deserialize, Serialize};

use crate::entities::{local_comment_store, LocalCommentStore};

/// 弹幕响应格式（dandanplay API 格式）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DanmakuResponse {
    pub count: i32,
    pub comments: Vec<DanmakuComment>,
}

/// 单条弹幕
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DanmakuComment {
    #[serde(rename = "cid")]
    pub id: i64,
    #[serde(rename = "p")]
    pub position: String,
    #[serde(rename = "m")]
    pub message: String,
}

/// 弹幕存储服务
/// 
/// 负责弹幕的文件系统存储和元数据管理
pub struct CommentStoreService {
    db: DatabaseConnection,
    danmaku_dir: PathBuf,
}

impl CommentStoreService {
    pub fn new(db: DatabaseConnection, danmaku_dir: impl Into<PathBuf>) -> Self {
        Self {
            db,
            danmaku_dir: danmaku_dir.into(),
        }
    }

    /// 生成文件路径（只保留字母数字和 -_）
    fn file_path(&self, episode_id: &str) -> PathBuf {
        let safe: String = episode_id
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
            .collect();
        self.danmaku_dir.join(format!("{}.json", safe))
    }

    /// 读取弹幕（命中返回 body + 元数据，并更新 last_used_at）
    pub async fn get(&self, episode_id: &str) -> Result<Option<DanmakuResponse>> {
        let episode_id = episode_id.trim();
        if episode_id.is_empty() {
            return Ok(None);
        }

        // 查询元数据
        let row = LocalCommentStore::find()
            .filter(local_comment_store::Column::EpisodeId.eq(episode_id))
            .one(&self.db)
            .await
            .context("Failed to query local_comment_store")?;

        let Some(row) = row else {
            return Ok(None);
        };

        // 检查文件是否存在
        let file_path = Path::new(&row.file_path);
        if !file_path.exists() {
            tracing::warn!("Danmaku file not found: {:?}", file_path);
            return Ok(None);
        }

        // 读取文件
        let body = fs::read_to_string(file_path)
            .with_context(|| format!("Failed to read danmaku file: {:?}", file_path))?;

        // 解析 JSON
        let response: DanmakuResponse = serde_json::from_str(&body)
            .context("Failed to parse danmaku JSON")?;

        // 更新 last_used_at
        let mut active: local_comment_store::ActiveModel = row.into();
        active.last_used_at = Set(Some(chrono::Utc::now().naive_utc()));
        active.update(&self.db).await?;

        Ok(Some(response))
    }

    /// 存储弹幕（以条数为准更新：新条数 >= 旧才覆盖）
    pub async fn archive(
        &self,
        episode_id: &str,
        body: &str,
        source: &str,
    ) -> Result<()> {
        let episode_id = episode_id.trim();
        if episode_id.is_empty() {
            anyhow::bail!("episode_id cannot be empty");
        }

        // 解析弹幕条数
        let comment_count = self.count_comments(body)?;

        // 查询现有记录
        let existing = LocalCommentStore::find()
            .filter(local_comment_store::Column::EpisodeId.eq(episode_id))
            .one(&self.db)
            .await?;

        // 如果已存在且新条数少于旧条数，跳过
        if let Some(ref row) = existing {
            if comment_count < row.comment_count {
                tracing::info!(
                    "Skip archiving: new count {} < existing count {} for episode {}",
                    comment_count, row.comment_count, episode_id
                );
                return Ok(());
            }
        }

        // 确保目录存在
        fs::create_dir_all(&self.danmaku_dir)
            .context("Failed to create danmaku directory")?;

        // 写入文件
        let file_path = self.file_path(episode_id);
        fs::write(&file_path, body)
            .with_context(|| format!("Failed to write danmaku file: {:?}", file_path))?;

        let size_bytes = body.len() as i64;
        let now = chrono::Utc::now().naive_utc();

        // 更新或插入元数据
        if let Some(row) = existing {
            let mut active: local_comment_store::ActiveModel = row.into();
            active.file_path = Set(file_path.to_string_lossy().to_string());
            active.size_bytes = Set(size_bytes);
            active.comment_count = Set(comment_count);
            active.source = Set(source.to_string());
            active.updated_at = Set(now);
            active.update(&self.db).await?;
        } else {
            let new_row = local_comment_store::ActiveModel {
                episode_id: Set(episode_id.to_string()),
                file_path: Set(file_path.to_string_lossy().to_string()),
                size_bytes: Set(size_bytes),
                comment_count: Set(comment_count),
                source: Set(source.to_string()),
                created_at: Set(now),
                updated_at: Set(now),
                last_used_at: Set(None),
                ..Default::default()
            };
            new_row.insert(&self.db).await?;
        }

        tracing::info!(
            "Archived {} comments for episode {} from {}",
            comment_count, episode_id, source
        );

        Ok(())
    }

    /// 解析弹幕条数
    fn count_comments(&self, body: &str) -> Result<i32> {
        let data: DanmakuResponse = serde_json::from_str(body)
            .context("Failed to parse danmaku JSON")?;
        Ok(data.comments.len() as i32)
    }

    /// 删除弹幕（删除文件和元数据）
    pub async fn delete(&self, episode_id: &str) -> Result<bool> {
        let episode_id = episode_id.trim();
        if episode_id.is_empty() {
            return Ok(false);
        }

        // 查询记录
        let row = LocalCommentStore::find()
            .filter(local_comment_store::Column::EpisodeId.eq(episode_id))
            .one(&self.db)
            .await?;

        let Some(row) = row else {
            return Ok(false);
        };

        // 删除文件
        let file_path = Path::new(&row.file_path);
        if file_path.exists() {
            fs::remove_file(file_path)
                .with_context(|| format!("Failed to delete danmaku file: {:?}", file_path))?;
        }

        // 删除元数据
        LocalCommentStore::delete_by_id(row.id)
            .exec(&self.db)
            .await?;

        tracing::info!("Deleted danmaku for episode {}", episode_id);
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_archive_and_get() {
        let config = crate::DbConfig::default();
        let db = crate::init_db(&config).await.unwrap();
        crate::test_helper::create_test_schema(&db).await.unwrap();

        let temp_dir = std::env::temp_dir().join("danmaku_test");
        let service = CommentStoreService::new(db, &temp_dir);

        let body = r#"{"count":2,"comments":[{"cid":1,"p":"10.5,1,25,16777215,1234567890","m":"测试弹幕1"},{"cid":2,"p":"20.0,1,25,16777215,1234567891","m":"测试弹幕2"}]}"#;

        // 存储
        service.archive("test_episode_1", body, "test").await.unwrap();

        // 读取
        let result = service.get("test_episode_1").await.unwrap();
        assert!(result.is_some());
        let response = result.unwrap();
        assert_eq!(response.count, 2);
        assert_eq!(response.comments.len(), 2);
        assert_eq!(response.comments[0].message, "测试弹幕1");

        // 清理
        service.delete("test_episode_1").await.unwrap();
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_skip_lower_count() {
        let config = crate::DbConfig::default();
        let db = crate::init_db(&config).await.unwrap();
        crate::test_helper::create_test_schema(&db).await.unwrap();

        let temp_dir = std::env::temp_dir().join("danmaku_test_skip");
        let service = CommentStoreService::new(db, &temp_dir);

        let body_2 = r#"{"count":2,"comments":[{"cid":1,"p":"10.5,1,25,16777215,1234567890","m":"弹幕1"},{"cid":2,"p":"20.0,1,25,16777215,1234567891","m":"弹幕2"}]}"#;
        let body_1 = r#"{"count":1,"comments":[{"cid":1,"p":"10.5,1,25,16777215,1234567890","m":"弹幕1"}]}"#;

        // 先存 2 条
        service.archive("test_episode_2", body_2, "test").await.unwrap();

        // 尝试存 1 条（应该跳过）
        service.archive("test_episode_2", body_1, "test").await.unwrap();

        // 读取应该还是 2 条
        let result = service.get("test_episode_2").await.unwrap().unwrap();
        assert_eq!(result.comments.len(), 2);

        // 清理
        service.delete("test_episode_2").await.unwrap();
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
