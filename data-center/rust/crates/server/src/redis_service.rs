use redis::{Client, aio::ConnectionManager, AsyncCommands, RedisError};
use std::time::Duration;
use tracing::{info, warn, error};

/// Redis 热缓存服务
/// 
/// 功能：
/// - 热数据缓存（响应体、计数器）
/// - 自动降级（Redis 不可用时返回 None）
/// - TTL 过期管理
/// - Key 命名空间隔离
pub struct RedisCacheService {
    manager: Option<ConnectionManager>,
    prefix: String,
    enabled: bool,
}

impl RedisCacheService {
    /// 创建 Redis 缓存服务（异步）
    /// 
    /// 环境变量：
    /// - REDIS_URL: redis://localhost:6379
    /// - REDIS_PREFIX: dd_cache:
    /// - REDIS_ENABLED: true/false
    pub async fn new() -> Self {
        let enabled = std::env::var("REDIS_ENABLED")
            .ok()
            .and_then(|s| s.parse::<bool>().ok())
            .unwrap_or(false);
        
        if !enabled {
            info!("ℹ️  Redis 未启用，缓存将降级到 SQL");
            return Self {
                manager: None,
                prefix: String::new(),
                enabled: false,
            };
        }
        
        let redis_url = std::env::var("REDIS_URL")
            .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
        
        let prefix = std::env::var("REDIS_PREFIX")
            .unwrap_or_else(|_| "dd_cache:".to_string());
        
        match Self::connect(&redis_url).await {
            Ok(manager) => {
                info!("✅ Redis 缓存已连接: {}", redis_url);
                Self {
                    manager: Some(manager),
                    prefix,
                    enabled: true,
                }
            },
            Err(e) => {
                warn!("⚠️  Redis 连接失败: {}，缓存降级到 SQL", e);
                Self {
                    manager: None,
                    prefix,
                    enabled: false,
                }
            }
        }
    }
    
    /// 创建 Redis 缓存服务（同步，用于测试）
    pub fn new_sync() -> Self {
        Self {
            manager: None,
            prefix: "dd_cache:".to_string(),
            enabled: false,
        }
    }
    
    /// 连接 Redis
    async fn connect(url: &str) -> Result<ConnectionManager, RedisError> {
        let client = Client::open(url)?;
        let manager = ConnectionManager::new(client).await?;
        Ok(manager)
    }
    
    /// 是否可用
    pub fn is_enabled(&self) -> bool {
        self.enabled && self.manager.is_some()
    }
    
    /// 构建完整 Key（带命名空间前缀）
    fn build_key(&self, key: &str) -> String {
        format!("{}{}", self.prefix, key)
    }
    
    /// 获取缓存值
    pub async fn get(&self, key: &str) -> Option<String> {
        let manager = self.manager.as_ref()?;
        let full_key = self.build_key(key);
        
        match manager.clone().get::<_, Option<String>>(&full_key).await {
            Ok(value) => value,
            Err(e) => {
                warn!("⚠️  Redis GET 失败 ({}): {}", full_key, e);
                None
            }
        }
    }
    
    /// 设置缓存值（带 TTL）
    pub async fn set(&self, key: &str, value: &str, ttl_secs: u64) -> bool {
        let manager = match self.manager.as_ref() {
            Some(m) => m,
            None => return false,
        };
        
        let full_key = self.build_key(key);
        
        match manager.clone().set_ex::<_, _, ()>(&full_key, value, ttl_secs).await {
            Ok(_) => true,
            Err(e) => {
                warn!("⚠️  Redis SET 失败 ({}): {}", full_key, e);
                false
            }
        }
    }
    
    /// 删除缓存值
    pub async fn del(&self, key: &str) -> bool {
        let manager = match self.manager.as_ref() {
            Some(m) => m,
            None => return false,
        };
        
        let full_key = self.build_key(key);
        
        match manager.clone().del::<_, ()>(&full_key).await {
            Ok(_) => true,
            Err(e) => {
                warn!("⚠️  Redis DEL 失败 ({}): {}", full_key, e);
                false
            }
        }
    }
    
    /// 检查 Key 是否存在
    pub async fn exists(&self, key: &str) -> bool {
        let manager = match self.manager.as_ref() {
            Some(m) => m,
            None => return false,
        };
        
        let full_key = self.build_key(key);
        
        match manager.clone().exists::<_, bool>(&full_key).await {
            Ok(exists) => exists,
            Err(e) => {
                warn!("⚠️  Redis EXISTS 失败 ({}): {}", full_key, e);
                false
            }
        }
    }
    
    /// 递增计数器
    pub async fn incr(&self, key: &str) -> Option<i64> {
        let manager = self.manager.as_ref()?;
        let full_key = self.build_key(key);
        
        match manager.clone().incr::<_, _, i64>(&full_key, 1).await {
            Ok(value) => Some(value),
            Err(e) => {
                warn!("⚠️  Redis INCR 失败 ({}): {}", full_key, e);
                None
            }
        }
    }
    
    /// 递减计数器
    pub async fn decr(&self, key: &str) -> Option<i64> {
        let manager = self.manager.as_ref()?;
        let full_key = self.build_key(key);
        
        match manager.clone().decr::<_, _, i64>(&full_key, 1).await {
            Ok(value) => Some(value),
            Err(e) => {
                warn!("⚠️  Redis DECR 失败 ({}): {}", full_key, e);
                None
            }
        }
    }
    
    /// 设置过期时间
    pub async fn expire(&self, key: &str, ttl_secs: u64) -> bool {
        let manager = match self.manager.as_ref() {
            Some(m) => m,
            None => return false,
        };
        
        let full_key = self.build_key(key);
        
        match manager.clone().expire::<_, ()>(&full_key, ttl_secs as i64).await {
            Ok(_) => true,
            Err(e) => {
                warn!("⚠️  Redis EXPIRE 失败 ({}): {}", full_key, e);
                false
            }
        }
    }
    
    /// 获取 TTL（剩余过期时间）
    pub async fn ttl(&self, key: &str) -> Option<i64> {
        let manager = self.manager.as_ref()?;
        let full_key = self.build_key(key);
        
        match manager.clone().ttl::<_, i64>(&full_key).await {
            Ok(ttl) => Some(ttl),
            Err(e) => {
                warn!("⚠️  Redis TTL 失败 ({}): {}", full_key, e);
                None
            }
        }
    }
    
    /// 批量删除（通配符匹配）
    pub async fn del_pattern(&self, pattern: &str) -> u64 {
        let manager = match self.manager.as_ref() {
            Some(m) => m,
            None => return 0,
        };
        
        let full_pattern = self.build_key(pattern);
        
        // 使用 SCAN + DEL 避免阻塞
        let mut count = 0u64;
        let mut conn = manager.clone();
        
        match redis::cmd("SCAN")
            .cursor_arg(0)
            .arg("MATCH")
            .arg(&full_pattern)
            .arg("COUNT")
            .arg(100)
            .query_async::<(u64, Vec<String>)>(&mut conn)
            .await
        {
            Ok((_, keys)) => {
                for key in keys {
                    if conn.del::<_, ()>(&key).await.is_ok() {
                        count += 1;
                    }
                }
            },
            Err(e) => {
                error!("⚠️  Redis SCAN 失败 ({}): {}", full_pattern, e);
            }
        }
        
        count
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_redis_service_disabled() {
        // 测试禁用状态
        std::env::set_var("REDIS_ENABLED", "false");
        let service = RedisCacheService::new().await;
        assert!(!service.is_enabled());
    }
    
    #[tokio::test]
    async fn test_build_key() {
        std::env::set_var("REDIS_ENABLED", "false");
        let service = RedisCacheService::new().await;
        // 即使禁用，prefix 也应该工作
        let service_with_prefix = RedisCacheService {
            manager: None,
            prefix: "test:".to_string(),
            enabled: false,
        };
        assert_eq!(service_with_prefix.build_key("foo"), "test:foo");
    }
}
