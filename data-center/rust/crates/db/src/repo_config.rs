use sea_orm::*;
use crate::entities::{config, config_secret};

/// 配置 Repository
pub struct ConfigRepo;

impl ConfigRepo {
    /// 获取配置值
    pub async fn get(
        db: &DatabaseConnection,
        namespace: &str,
        key: &str,
    ) -> Result<Option<String>, DbErr> {
        let result = config::Entity::find()
            .filter(config::Column::Namespace.eq(namespace))
            .filter(config::Column::ConfigKey.eq(key))
            .one(db)
            .await?;
        
        Ok(result.and_then(|c| c.value_text))
    }
    
    /// 设置配置值
    pub async fn set(
        db: &DatabaseConnection,
        namespace: &str,
        key: &str,
        value: &str,
        description: Option<String>,
    ) -> Result<config::Model, DbErr> {
        let now = chrono::Utc::now().naive_utc();
        
        // 查找是否已存在
        let existing = config::Entity::find()
            .filter(config::Column::Namespace.eq(namespace))
            .filter(config::Column::ConfigKey.eq(key))
            .one(db)
            .await?;
        
        if let Some(existing_config) = existing {
            // 更新
            let mut active: config::ActiveModel = existing_config.into();
            active.value_text = Set(Some(value.to_string()));
            if let Some(desc) = description {
                active.description = Set(Some(desc));
            }
            active.updated_at = Set(now);
            
            active.update(db).await
        } else {
            // 创建
            let new_config = config::ActiveModel {
                namespace: Set(namespace.to_string()),
                config_key: Set(key.to_string()),
                value_type: Set("string".to_string()),
                value_text: Set(Some(value.to_string())),
                is_secret: Set(false),
                description: Set(description),
                created_at: Set(now),
                updated_at: Set(now),
                ..Default::default()
            };
            
            new_config.insert(db).await
        }
    }
    
    /// 删除配置
    pub async fn delete(
        db: &DatabaseConnection,
        namespace: &str,
        key: &str,
    ) -> Result<(), DbErr> {
        config::Entity::delete_many()
            .filter(config::Column::Namespace.eq(namespace))
            .filter(config::Column::ConfigKey.eq(key))
            .exec(db)
            .await?;
        
        Ok(())
    }
    
    /// 获取命名空间下的所有配置
    pub async fn get_by_namespace(
        db: &DatabaseConnection,
        namespace: &str,
    ) -> Result<Vec<config::Model>, DbErr> {
        config::Entity::find()
            .filter(config::Column::Namespace.eq(namespace))
            .all(db)
            .await
    }
    
    /// 获取所有配置
    pub async fn get_all(db: &DatabaseConnection) -> Result<Vec<config::Model>, DbErr> {
        config::Entity::find()
            .order_by_asc(config::Column::Namespace)
            .order_by_asc(config::Column::ConfigKey)
            .all(db)
            .await
    }
}

/// 敏感配置 Repository
pub struct ConfigSecretRepo;

impl ConfigSecretRepo {
    /// 获取敏感配置
    pub async fn get(
        db: &DatabaseConnection,
        namespace: &str,
        key: &str,
    ) -> Result<Option<String>, DbErr> {
        let result = config_secret::Entity::find()
            .filter(config_secret::Column::Namespace.eq(namespace))
            .filter(config_secret::Column::ConfigKey.eq(key))
            .one(db)
            .await?;
        
        Ok(result.map(|c| c.value_hash))
    }
    
    /// 设置敏感配置
    pub async fn set(
        db: &DatabaseConnection,
        namespace: &str,
        key: &str,
        value: &str,
    ) -> Result<config_secret::Model, DbErr> {
        let now = chrono::Utc::now().naive_utc();
        
        // 查找是否已存在
        let existing = config_secret::Entity::find()
            .filter(config_secret::Column::Namespace.eq(namespace))
            .filter(config_secret::Column::ConfigKey.eq(key))
            .one(db)
            .await?;
        
        if let Some(existing_secret) = existing {
            // 更新
            let mut active: config_secret::ActiveModel = existing_secret.into();
            active.value_hash = Set(hash_secret(value));
            active.updated_at = Set(now);
            
            active.update(db).await
        } else {
            // 创建
            let new_secret = config_secret::ActiveModel {
                namespace: Set(namespace.to_string()),
                config_key: Set(key.to_string()),
                value_hash: Set(hash_secret(value)),
                created_at: Set(now),
                updated_at: Set(now),
                ..Default::default()
            };
            
            new_secret.insert(db).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_config_repo() {
        // 需要数据库连接，标记为 #[ignore]
    }
}

/// config_secrets 只保存 SHA-256 摘要，不保存明文。
fn hash_secret(value: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(value.as_bytes());
    digest.iter().map(|b| format!("{:02x}", b)).collect()
}
