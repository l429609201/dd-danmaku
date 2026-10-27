use sea_orm::DatabaseConnection;
use db::CacheRepo;
use anyhow::{Result, Context};

/// 缓存响应结构
#[derive(Debug, Clone)]
pub struct CachedResponse {
    pub body: String,
    pub status_code: i32,
    pub storage_mode: String,
}

/// 缓存服务
pub struct CacheService {
    repo: CacheRepo,
}

impl CacheService {
    pub fn new(db: DatabaseConnection) -> Self {
        Self {
            repo: CacheRepo::new(db),
        }
    }

    /// 查询缓存（SQL 模式，暂不支持 Redis）
    pub async fn get(&self, cache_key: &str) -> Result<Option<CachedResponse>> {
        let now = chrono::Utc::now().naive_utc();
        
        // 查询未过期的缓存
        let cache = self.repo
            .find_valid_by_key(cache_key, now)
            .await
            .context("Failed to query cache")?;
        
        if let Some(cache) = cache {
            // 更新命中计数
            if let Err(e) = self.repo.increment_hit(cache.id).await {
                tracing::warn!("Failed to increment hit count: {}", e);
            }
            
            // 返回响应体
            if let Some(body) = cache.response_body {
                return Ok(Some(CachedResponse {
                    body,
                    status_code: cache.status_code,
                    storage_mode: cache.storage_mode,
                }));
            }
        }
        
        Ok(None)
    }

    /// 写入缓存（SQL 模式）
    pub async fn set(
        &self,
        cache_key: &str,
        response_body: &str,
        status_code: i32,
        ttl_seconds: i64,
    ) -> Result<()> {
        use sea_orm::Set;
        use db::entities::api_response_cache;
        
        let now = chrono::Utc::now().naive_utc();
        let expire_at = now + chrono::Duration::seconds(ttl_seconds);
        let refresh_after = now + chrono::Duration::seconds(ttl_seconds / 2);
        
        let body_hash = format!("{:x}", md5::compute(response_body.as_bytes()));
        
        let model = api_response_cache::ActiveModel {
            cache_key: Set(cache_key.to_string()),
            source: Set("dandanplay".to_string()),
            method: Set("GET".to_string()),
            api_path: Set("/api/v2".to_string()), // 简化，实际应传入
            normalized_query: Set(None),
            query_json: Set(None),
            request_body_hash: Set(None),
            request_body_json: Set(None),
            client_ip: Set(None),
            status_code: Set(status_code),
            response_headers_json: Set(None),
            response_body: Set(Some(response_body.to_string())),
            redis_key: Set(None),
            storage_mode: Set("sql".to_string()),
            body_hash: Set(body_hash),
            body_size: Set(response_body.len() as i32),
            fetched_at: Set(now),
            last_used_at: Set(None),
            last_refresh_at: Set(None),
            refresh_after: Set(refresh_after),
            expire_at: Set(expire_at),
            refresh_pending: Set(false),
            hit_count: Set(0),
            stale_hit_count: Set(0),
            upstream_429_count: Set(0),
            is_empty: Set(response_body.is_empty() || response_body == "[]"),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };
        
        self.repo.upsert(model).await
            .context("Failed to upsert cache")?;
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use db::{init_db, DbConfig, test_helper::create_test_schema};

    async fn setup_test_service() -> CacheService {
        let config = DbConfig::default();
        let db = init_db(&config).await.expect("Failed to init db");
        create_test_schema(&db).await.expect("Failed to create schema");
        CacheService::new(db)
    }

    #[tokio::test]
    async fn test_cache_service_set_and_get() {
        let service = setup_test_service().await;
        
        // 写入缓存
        service.set(
            "test:key:1",
            r#"{"success":true,"data":"test"}"#,
            200,
            3600,
        ).await.unwrap();
        
        // 读取缓存
        let result = service.get("test:key:1").await.unwrap();
        assert!(result.is_some());
        
        let cached = result.unwrap();
        assert_eq!(cached.status_code, 200);
        assert_eq!(cached.storage_mode, "sql");
        assert!(cached.body.contains("success"));
    }

    #[tokio::test]
    async fn test_cache_miss() {
        let service = setup_test_service().await;
        
        let result = service.get("nonexistent:key").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_cache_expiry() {
        let service = setup_test_service().await;
        
        // 写入一个 TTL 很短的缓存（1 秒）
        service.set(
            "test:expire:1",
            r#"{"data":"will expire"}"#,
            200,
            1,
        ).await.unwrap();
        
        // 立即读取应该成功
        let result = service.get("test:expire:1").await.unwrap();
        assert!(result.is_some());
        
        // 等待过期（2 秒）
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        
        // 再次读取应该失败
        let result = service.get("test:expire:1").await.unwrap();
        assert!(result.is_none());
    }
}
