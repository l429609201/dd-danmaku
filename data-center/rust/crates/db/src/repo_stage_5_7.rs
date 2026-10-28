use sea_orm::*;
use sea_orm::sea_query::Expr;
use crate::entities::{api_key_pool, sign_key_pool, user_allow_pool, oauth_config, worker_log, ip_stats, cleanup_policy};

// ==================== 阶段 5: 密钥和安全 ====================

/// API 密钥池仓储
pub struct ApiKeyPoolRepo;

impl ApiKeyPoolRepo {
    pub async fn find_all(
        db: &DatabaseConnection,
        offset: u64,
        limit: u64,
    ) -> Result<(Vec<api_key_pool::Model>, u64), DbErr> {
        let query = api_key_pool::Entity::find().order_by_desc(api_key_pool::Column::CreatedAt);
        let total = query.clone().count(db).await?;
        let keys = query.offset(offset).limit(limit).all(db).await?;
        Ok((keys, total))
    }
    
    pub async fn find_by_id(db: &DatabaseConnection, id: i64) -> Result<Option<api_key_pool::Model>, DbErr> {
        api_key_pool::Entity::find_by_id(id).one(db).await
    }
    
    pub async fn find_active(db: &DatabaseConnection) -> Result<Vec<api_key_pool::Model>, DbErr> {
        api_key_pool::Entity::find()
            .filter(api_key_pool::Column::IsActive.eq(true))
            .order_by_asc(api_key_pool::Column::Priority)
            .all(db)
            .await
    }
    
    pub async fn create(
        db: &DatabaseConnection,
        name: String,
        api_key: String,
        source: String,
        priority: i32,
    ) -> Result<api_key_pool::Model, DbErr> {
        let now = chrono::Utc::now().naive_utc();
        let model = api_key_pool::ActiveModel {
            name: Set(name),
            api_key: Set(api_key),
            source: Set(source),
            is_active: Set(true),
            priority: Set(priority),
            last_used_at: Set(None),
            use_count: Set(0),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };
        model.insert(db).await
    }
    
    pub async fn update(
        db: &DatabaseConnection,
        id: i64,
        name: Option<String>,
        api_key: Option<String>,
        source: Option<String>,
        is_active: Option<bool>,
        priority: Option<i32>,
    ) -> Result<api_key_pool::Model, DbErr> {
        let model = api_key_pool::Entity::find_by_id(id)
            .one(db)
            .await?
            .ok_or(DbErr::RecordNotFound("API key not found".to_string()))?;
        
        let mut active: api_key_pool::ActiveModel = model.into();
        if let Some(n) = name { active.name = Set(n); }
        if let Some(k) = api_key { active.api_key = Set(k); }
        if let Some(s) = source { active.source = Set(s); }
        if let Some(a) = is_active { active.is_active = Set(a); }
        if let Some(p) = priority { active.priority = Set(p); }
        active.updated_at = Set(chrono::Utc::now().naive_utc());
        
        active.update(db).await
    }
    
    pub async fn delete(db: &DatabaseConnection, id: i64) -> Result<bool, DbErr> {
        let result = api_key_pool::Entity::delete_by_id(id).exec(db).await?;
        Ok(result.rows_affected > 0)
    }
    
    pub async fn increment_use_count(db: &DatabaseConnection, id: i64) -> Result<(), DbErr> {
        api_key_pool::Entity::update_many()
            .filter(api_key_pool::Column::Id.eq(id))
            .col_expr(api_key_pool::Column::UseCount, Expr::col(api_key_pool::Column::UseCount).add(1))
            .col_expr(api_key_pool::Column::LastUsedAt, Expr::value(chrono::Utc::now().naive_utc()))
            .exec(db)
            .await?;
        Ok(())
    }
}

/// 签名密钥池仓储
pub struct SignKeyPoolRepo;

impl SignKeyPoolRepo {
    pub async fn find_all(
        db: &DatabaseConnection,
        offset: u64,
        limit: u64,
    ) -> Result<(Vec<sign_key_pool::Model>, u64), DbErr> {
        let query = sign_key_pool::Entity::find().order_by_desc(sign_key_pool::Column::CreatedAt);
        let total = query.clone().count(db).await?;
        let keys = query.offset(offset).limit(limit).all(db).await?;
        Ok((keys, total))
    }
    
    pub async fn find_by_id(db: &DatabaseConnection, id: i64) -> Result<Option<sign_key_pool::Model>, DbErr> {
        sign_key_pool::Entity::find_by_id(id).one(db).await
    }
    
    pub async fn find_active(db: &DatabaseConnection) -> Result<Vec<sign_key_pool::Model>, DbErr> {
        sign_key_pool::Entity::find()
            .filter(sign_key_pool::Column::IsActive.eq(true))
            .all(db)
            .await
    }
    
    pub async fn create(
        db: &DatabaseConnection,
        name: String,
        sign_key: String,
        purpose: String,
    ) -> Result<sign_key_pool::Model, DbErr> {
        let now = chrono::Utc::now().naive_utc();
        let model = sign_key_pool::ActiveModel {
            name: Set(name),
            sign_key: Set(sign_key),
            purpose: Set(purpose),
            is_active: Set(true),
            last_used_at: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };
        model.insert(db).await
    }
    
    pub async fn update(
        db: &DatabaseConnection,
        id: i64,
        name: Option<String>,
        sign_key: Option<String>,
        purpose: Option<String>,
        is_active: Option<bool>,
    ) -> Result<sign_key_pool::Model, DbErr> {
        let model = sign_key_pool::Entity::find_by_id(id)
            .one(db)
            .await?
            .ok_or(DbErr::RecordNotFound("Sign key not found".to_string()))?;
        
        let mut active: sign_key_pool::ActiveModel = model.into();
        if let Some(n) = name { active.name = Set(n); }
        if let Some(k) = sign_key { active.sign_key = Set(k); }
        if let Some(p) = purpose { active.purpose = Set(p); }
        if let Some(a) = is_active { active.is_active = Set(a); }
        active.updated_at = Set(chrono::Utc::now().naive_utc());
        
        active.update(db).await
    }
    
    pub async fn delete(db: &DatabaseConnection, id: i64) -> Result<bool, DbErr> {
        let result = sign_key_pool::Entity::delete_by_id(id).exec(db).await?;
        Ok(result.rows_affected > 0)
    }
}

/// 用户白名单仓储
pub struct UserAllowPoolRepo;

impl UserAllowPoolRepo {
    pub async fn find_all(
        db: &DatabaseConnection,
        offset: u64,
        limit: u64,
    ) -> Result<(Vec<user_allow_pool::Model>, u64), DbErr> {
        let query = user_allow_pool::Entity::find().order_by_desc(user_allow_pool::Column::CreatedAt);
        let total = query.clone().count(db).await?;
        let users = query.offset(offset).limit(limit).all(db).await?;
        Ok((users, total))
    }
    
    pub async fn find_by_id(db: &DatabaseConnection, id: i64) -> Result<Option<user_allow_pool::Model>, DbErr> {
        user_allow_pool::Entity::find_by_id(id).one(db).await
    }
    
    pub async fn find_by_identifier(db: &DatabaseConnection, identifier: &str) -> Result<Option<user_allow_pool::Model>, DbErr> {
        user_allow_pool::Entity::find()
            .filter(user_allow_pool::Column::UserIdentifier.eq(identifier))
            .one(db)
            .await
    }
    
    pub async fn create(
        db: &DatabaseConnection,
        user_identifier: String,
        user_type: String,
        description: Option<String>,
    ) -> Result<user_allow_pool::Model, DbErr> {
        let now = chrono::Utc::now().naive_utc();
        let model = user_allow_pool::ActiveModel {
            user_identifier: Set(user_identifier),
            user_type: Set(user_type),
            description: Set(description),
            is_active: Set(true),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };
        model.insert(db).await
    }
    
    pub async fn update(
        db: &DatabaseConnection,
        id: i64,
        user_type: Option<String>,
        description: Option<String>,
        is_active: Option<bool>,
    ) -> Result<user_allow_pool::Model, DbErr> {
        let model = user_allow_pool::Entity::find_by_id(id)
            .one(db)
            .await?
            .ok_or(DbErr::RecordNotFound("User not found".to_string()))?;
        
        let mut active: user_allow_pool::ActiveModel = model.into();
        if let Some(t) = user_type { active.user_type = Set(t); }
        if description.is_some() { active.description = Set(description); }
        if let Some(a) = is_active { active.is_active = Set(a); }
        active.updated_at = Set(chrono::Utc::now().naive_utc());
        
        active.update(db).await
    }
    
    pub async fn delete(db: &DatabaseConnection, id: i64) -> Result<bool, DbErr> {
        let result = user_allow_pool::Entity::delete_by_id(id).exec(db).await?;
        Ok(result.rows_affected > 0)
    }
}

/// OAuth 配置仓储
pub struct OAuthConfigRepo;

impl OAuthConfigRepo {
    pub async fn find_all(db: &DatabaseConnection) -> Result<Vec<oauth_config::Model>, DbErr> {
        oauth_config::Entity::find()
            .order_by_asc(oauth_config::Column::Provider)
            .all(db)
            .await
    }
    
    pub async fn find_by_id(db: &DatabaseConnection, id: i64) -> Result<Option<oauth_config::Model>, DbErr> {
        oauth_config::Entity::find_by_id(id).one(db).await
    }
    
    pub async fn find_by_provider(db: &DatabaseConnection, provider: &str) -> Result<Option<oauth_config::Model>, DbErr> {
        oauth_config::Entity::find()
            .filter(oauth_config::Column::Provider.eq(provider))
            .one(db)
            .await
    }
    
    pub async fn create(
        db: &DatabaseConnection,
        provider: String,
        client_id: String,
        client_secret: String,
        redirect_uri: String,
        scope: Option<String>,
    ) -> Result<oauth_config::Model, DbErr> {
        let now = chrono::Utc::now().naive_utc();
        let model = oauth_config::ActiveModel {
            provider: Set(provider),
            client_id: Set(client_id),
            client_secret: Set(client_secret),
            redirect_uri: Set(redirect_uri),
            scope: Set(scope),
            is_active: Set(true),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };
        model.insert(db).await
    }
    
    pub async fn update(
        db: &DatabaseConnection,
        id: i64,
        client_id: Option<String>,
        client_secret: Option<String>,
        redirect_uri: Option<String>,
        scope: Option<String>,
        is_active: Option<bool>,
    ) -> Result<oauth_config::Model, DbErr> {
        let model = oauth_config::Entity::find_by_id(id)
            .one(db)
            .await?
            .ok_or(DbErr::RecordNotFound("OAuth config not found".to_string()))?;
        
        let mut active: oauth_config::ActiveModel = model.into();
        if let Some(c) = client_id { active.client_id = Set(c); }
        if let Some(s) = client_secret { active.client_secret = Set(s); }
        if let Some(r) = redirect_uri { active.redirect_uri = Set(r); }
        if scope.is_some() { active.scope = Set(scope); }
        if let Some(a) = is_active { active.is_active = Set(a); }
        active.updated_at = Set(chrono::Utc::now().naive_utc());
        
        active.update(db).await
    }
    
    pub async fn delete(db: &DatabaseConnection, id: i64) -> Result<bool, DbErr> {
        let result = oauth_config::Entity::delete_by_id(id).exec(db).await?;
        Ok(result.rows_affected > 0)
    }
}

// ==================== 阶段 6: 日志和监控 ====================

/// Worker 日志仓储
pub struct WorkerLogRepo;

impl WorkerLogRepo {
    pub async fn find_all(
        db: &DatabaseConnection,
        offset: u64,
        limit: u64,
        level: Option<String>,
        node_id: Option<String>,
    ) -> Result<(Vec<worker_log::Model>, u64), DbErr> {
        let mut query = worker_log::Entity::find();
        
        if let Some(l) = level {
            query = query.filter(worker_log::Column::Level.eq(l));
        }
        if let Some(n) = node_id {
            query = query.filter(worker_log::Column::NodeId.eq(n));
        }
        
        query = query.order_by_desc(worker_log::Column::CreatedAt);
        
        let total = query.clone().count(db).await?;
        let logs = query.offset(offset).limit(limit).all(db).await?;
        Ok((logs, total))
    }
    
    pub async fn create(
        db: &DatabaseConnection,
        node_id: Option<String>,
        level: String,
        message: String,
        extra_data: Option<String>,
    ) -> Result<worker_log::Model, DbErr> {
        let model = worker_log::ActiveModel {
            node_id: Set(node_id),
            level: Set(level),
            message: Set(message),
            extra_data: Set(extra_data),
            created_at: Set(chrono::Utc::now().naive_utc()),
            ..Default::default()
        };
        model.insert(db).await
    }
    
    pub async fn delete_old(db: &DatabaseConnection, before: chrono::NaiveDateTime) -> Result<u64, DbErr> {
        let result = worker_log::Entity::delete_many()
            .filter(worker_log::Column::CreatedAt.lt(before))
            .exec(db)
            .await?;
        Ok(result.rows_affected)
    }
}

/// IP 统计仓储
pub struct IpStatsRepo;

impl IpStatsRepo {
    pub async fn find_all(
        db: &DatabaseConnection,
        offset: u64,
        limit: u64,
        ip: Option<String>,
    ) -> Result<(Vec<ip_stats::Model>, u64), DbErr> {
        let mut query = ip_stats::Entity::find();
        
        if let Some(i) = ip {
            query = query.filter(ip_stats::Column::IpAddress.eq(i));
        }
        
        query = query.order_by_desc(ip_stats::Column::RequestTime);
        
        let total = query.clone().count(db).await?;
        let stats = query.offset(offset).limit(limit).all(db).await?;
        Ok((stats, total))
    }
    
    pub async fn create(
        db: &DatabaseConnection,
        ip_address: String,
        path: String,
        method: String,
        status_code: i32,
        user_agent: Option<String>,
        response_time_ms: Option<i32>,
    ) -> Result<ip_stats::Model, DbErr> {
        let model = ip_stats::ActiveModel {
            ip_address: Set(ip_address),
            path: Set(path),
            method: Set(method),
            status_code: Set(status_code),
            user_agent: Set(user_agent),
            request_time: Set(chrono::Utc::now().naive_utc()),
            response_time_ms: Set(response_time_ms),
            ..Default::default()
        };
        model.insert(db).await
    }
    
    pub async fn get_top_ips(db: &DatabaseConnection, limit: u64) -> Result<Vec<(String, i64)>, DbErr> {
        // 简化实现：返回最近的 IP 和计数
        let stats = ip_stats::Entity::find()
            .limit(limit)
            .all(db)
            .await?;
        
        let mut ip_counts = std::collections::HashMap::new();
        for stat in stats {
            *ip_counts.entry(stat.ip_address).or_insert(0) += 1;
        }
        
        let mut result: Vec<_> = ip_counts.into_iter().collect();
        result.sort_by(|a, b| b.1.cmp(&a.1));
        result.truncate(limit as usize);
        Ok(result)
    }
    
    pub async fn delete_old(db: &DatabaseConnection, before: chrono::NaiveDateTime) -> Result<u64, DbErr> {
        let result = ip_stats::Entity::delete_many()
            .filter(ip_stats::Column::RequestTime.lt(before))
            .exec(db)
            .await?;
        Ok(result.rows_affected)
    }
}

// ==================== 阶段 7: 数据清理 ====================

/// 清理策略仓储
pub struct CleanupPolicyRepo;

impl CleanupPolicyRepo {
    pub async fn find_all(db: &DatabaseConnection) -> Result<Vec<cleanup_policy::Model>, DbErr> {
        cleanup_policy::Entity::find()
            .order_by_asc(cleanup_policy::Column::Name)
            .all(db)
            .await
    }
    
    pub async fn find_by_id(db: &DatabaseConnection, id: i64) -> Result<Option<cleanup_policy::Model>, DbErr> {
        cleanup_policy::Entity::find_by_id(id).one(db).await
    }
    
    pub async fn find_active(db: &DatabaseConnection) -> Result<Vec<cleanup_policy::Model>, DbErr> {
        cleanup_policy::Entity::find()
            .filter(cleanup_policy::Column::IsActive.eq(true))
            .all(db)
            .await
    }
    
    pub async fn create(
        db: &DatabaseConnection,
        name: String,
        target_table: String,
        condition: String,
        retention_days: i32,
        schedule: String,
    ) -> Result<cleanup_policy::Model, DbErr> {
        let now = chrono::Utc::now().naive_utc();
        let model = cleanup_policy::ActiveModel {
            name: Set(name),
            target_table: Set(target_table),
            condition: Set(condition),
            retention_days: Set(retention_days),
            is_active: Set(true),
            schedule: Set(schedule),
            last_run_at: Set(None),
            last_cleanup_count: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };
        model.insert(db).await
    }
    
    pub async fn update(
        db: &DatabaseConnection,
        id: i64,
        name: Option<String>,
        condition: Option<String>,
        retention_days: Option<i32>,
        is_active: Option<bool>,
        schedule: Option<String>,
    ) -> Result<cleanup_policy::Model, DbErr> {
        let model = cleanup_policy::Entity::find_by_id(id)
            .one(db)
            .await?
            .ok_or(DbErr::RecordNotFound("Cleanup policy not found".to_string()))?;
        
        let mut active: cleanup_policy::ActiveModel = model.into();
        if let Some(n) = name { active.name = Set(n); }
        if let Some(c) = condition { active.condition = Set(c); }
        if let Some(r) = retention_days { active.retention_days = Set(r); }
        if let Some(a) = is_active { active.is_active = Set(a); }
        if let Some(s) = schedule { active.schedule = Set(s); }
        active.updated_at = Set(chrono::Utc::now().naive_utc());
        
        active.update(db).await
    }
    
    pub async fn delete(db: &DatabaseConnection, id: i64) -> Result<bool, DbErr> {
        let result = cleanup_policy::Entity::delete_by_id(id).exec(db).await?;
        Ok(result.rows_affected > 0)
    }
    
    pub async fn update_last_run(
        db: &DatabaseConnection,
        id: i64,
        cleanup_count: i64,
    ) -> Result<(), DbErr> {
        cleanup_policy::Entity::update_many()
            .filter(cleanup_policy::Column::Id.eq(id))
            .col_expr(cleanup_policy::Column::LastRunAt, Expr::value(chrono::Utc::now().naive_utc()))
            .col_expr(cleanup_policy::Column::LastCleanupCount, Expr::value(cleanup_count))
            .exec(db)
            .await?;
        Ok(())
    }
}
