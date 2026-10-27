use sea_orm::{entity::*, query::*, DatabaseConnection, DbErr};
use crate::entities::api_response_cache;

/// 缓存响应 Repository
pub struct CacheRepo {
    db: DatabaseConnection,
}

impl CacheRepo {
    pub fn new(db: DatabaseConnection) -> Self {
        Self { db }
    }

    /// 根据缓存键查询
    pub async fn find_by_key(&self, cache_key: &str) -> Result<Option<api_response_cache::Model>, DbErr> {
        api_response_cache::Entity::find()
            .filter(api_response_cache::Column::CacheKey.eq(cache_key))
            .one(&self.db)
            .await
    }

    /// 查询未过期的缓存
    pub async fn find_valid_by_key(
        &self,
        cache_key: &str,
        now: chrono::NaiveDateTime,
    ) -> Result<Option<api_response_cache::Model>, DbErr> {
        api_response_cache::Entity::find()
            .filter(api_response_cache::Column::CacheKey.eq(cache_key))
            .filter(api_response_cache::Column::ExpireAt.gt(now))
            .one(&self.db)
            .await
    }

    /// 插入或更新缓存
    pub async fn upsert(&self, model: api_response_cache::ActiveModel) -> Result<api_response_cache::Model, DbErr> {
        model.save(&self.db).await?.try_into_model()
    }

    /// 更新命中计数
    pub async fn increment_hit(&self, id: i64) -> Result<(), DbErr> {
        // 先查询当前记录
        let cache = api_response_cache::Entity::find_by_id(id)
            .one(&self.db)
            .await?;
        
        if let Some(cache) = cache {
            let now = chrono::Utc::now().naive_utc();
            let mut active: api_response_cache::ActiveModel = cache.into();
            active.hit_count = Set(active.hit_count.unwrap() + 1);
            active.last_used_at = Set(Some(now));
            active.updated_at = Set(now);
            active.update(&self.db).await?;
        }
        
        Ok(())
    }

    /// 查询需要刷新的缓存
    pub async fn find_stale(
        &self,
        now: chrono::NaiveDateTime,
        limit: u64,
    ) -> Result<Vec<api_response_cache::Model>, DbErr> {
        api_response_cache::Entity::find()
            .filter(api_response_cache::Column::RefreshAfter.lt(now))
            .filter(api_response_cache::Column::RefreshPending.eq(false))
            .limit(limit)
            .all(&self.db)
            .await
    }

    /// 标记为待刷新
    pub async fn mark_refresh_pending(&self, id: i64) -> Result<(), DbErr> {
        let cache = api_response_cache::Entity::find_by_id(id)
            .one(&self.db)
            .await?;
        
        if let Some(cache) = cache {
            let mut active: api_response_cache::ActiveModel = cache.into();
            active.refresh_pending = Set(true);
            active.updated_at = Set(chrono::Utc::now().naive_utc());
            active.update(&self.db).await?;
        }
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{init_db, DbConfig, test_helper::create_test_schema};

    async fn setup_test_db() -> DatabaseConnection {
        let config = DbConfig::default();
        let db = init_db(&config).await.expect("Failed to init test db");
        create_test_schema(&db).await.expect("Failed to create schema");
        db
    }

    #[tokio::test]
    async fn test_cache_repo_basic_operations() {
        let db = setup_test_db().await;
        let repo = CacheRepo::new(db);

        // 查询不存在的缓存
        let result = repo.find_by_key("test_key").await.unwrap();
        assert!(result.is_none());

        // 插入缓存
        let now = chrono::Utc::now().naive_utc();
        let expire_at = now + chrono::Duration::hours(24);
        let refresh_after = now + chrono::Duration::hours(1);

        let model = api_response_cache::ActiveModel {
            cache_key: Set("test_key".to_string()),
            source: Set("dandanplay".to_string()),
            method: Set("GET".to_string()),
            api_path: Set("/api/v2/test".to_string()),
            normalized_query: Set(None),
            query_json: Set(None),
            request_body_hash: Set(None),
            request_body_json: Set(None),
            client_ip: Set(Some("127.0.0.1".to_string())),
            status_code: Set(200),
            response_headers_json: Set(None),
            response_body: Set(Some(r#"{"success":true}"#.to_string())),
            redis_key: Set(None),
            storage_mode: Set("sql".to_string()),
            body_hash: Set("abc123".to_string()),
            body_size: Set(18),
            fetched_at: Set(now),
            last_used_at: Set(None),
            last_refresh_at: Set(None),
            refresh_after: Set(refresh_after),
            expire_at: Set(expire_at),
            refresh_pending: Set(false),
            hit_count: Set(0),
            stale_hit_count: Set(0),
            upstream_429_count: Set(0),
            is_empty: Set(false),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };

        let inserted = repo.upsert(model).await.unwrap();
        assert_eq!(inserted.cache_key, "test_key");
        assert_eq!(inserted.hit_count, 0);

        // 查询已插入的缓存
        let found = repo.find_by_key("test_key").await.unwrap();
        assert!(found.is_some());
        let found = found.unwrap();
        assert_eq!(found.cache_key, "test_key");
        assert_eq!(found.storage_mode, "sql");

        // 更新命中计数
        repo.increment_hit(inserted.id).await.unwrap();

        let updated = repo.find_by_key("test_key").await.unwrap().unwrap();
        assert_eq!(updated.hit_count, 1);
        assert!(updated.last_used_at.is_some());
    }

    #[tokio::test]
    async fn test_find_valid_cache() {
        let db = setup_test_db().await;
        let repo = CacheRepo::new(db);

        let now = chrono::Utc::now().naive_utc();
        
        // 插入已过期的缓存
        let expired_model = api_response_cache::ActiveModel {
            cache_key: Set("expired_key".to_string()),
            source: Set("dandanplay".to_string()),
            method: Set("GET".to_string()),
            api_path: Set("/api/v2/test".to_string()),
            normalized_query: Set(None),
            query_json: Set(None),
            request_body_hash: Set(None),
            request_body_json: Set(None),
            client_ip: Set(None),
            status_code: Set(200),
            response_headers_json: Set(None),
            response_body: Set(Some("expired".to_string())),
            redis_key: Set(None),
            storage_mode: Set("sql".to_string()),
            body_hash: Set("expired123".to_string()),
            body_size: Set(7),
            fetched_at: Set(now - chrono::Duration::hours(48)),
            last_used_at: Set(None),
            last_refresh_at: Set(None),
            refresh_after: Set(now - chrono::Duration::hours(24)),
            expire_at: Set(now - chrono::Duration::hours(1)), // 已过期
            refresh_pending: Set(false),
            hit_count: Set(0),
            stale_hit_count: Set(0),
            upstream_429_count: Set(0),
            is_empty: Set(false),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };
        repo.upsert(expired_model).await.unwrap();

        // 查询过期缓存应返回 None
        let result = repo.find_valid_by_key("expired_key", now).await.unwrap();
        assert!(result.is_none());

        // 插入有效缓存
        let valid_model = api_response_cache::ActiveModel {
            cache_key: Set("valid_key".to_string()),
            source: Set("dandanplay".to_string()),
            method: Set("GET".to_string()),
            api_path: Set("/api/v2/test".to_string()),
            normalized_query: Set(None),
            query_json: Set(None),
            request_body_hash: Set(None),
            request_body_json: Set(None),
            client_ip: Set(None),
            status_code: Set(200),
            response_headers_json: Set(None),
            response_body: Set(Some("valid".to_string())),
            redis_key: Set(None),
            storage_mode: Set("sql".to_string()),
            body_hash: Set("valid123".to_string()),
            body_size: Set(5),
            fetched_at: Set(now),
            last_used_at: Set(None),
            last_refresh_at: Set(None),
            refresh_after: Set(now + chrono::Duration::hours(1)),
            expire_at: Set(now + chrono::Duration::hours(24)), // 未过期
            refresh_pending: Set(false),
            hit_count: Set(0),
            stale_hit_count: Set(0),
            upstream_429_count: Set(0),
            is_empty: Set(false),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };
        repo.upsert(valid_model).await.unwrap();

        // 查询有效缓存应返回数据
        let result = repo.find_valid_by_key("valid_key", now).await.unwrap();
        assert!(result.is_some());
        assert_eq!(result.unwrap().cache_key, "valid_key");
    }
}
