use sea_orm::*;
use crate::entities::{ip_rule, IpRule};

/// IP 规则仓储
pub struct IpRuleRepo;

impl IpRuleRepo {
    /// 获取所有 IP 规则（按优先级排序）
    pub async fn find_all(
        db: &DatabaseConnection,
        offset: u64,
        limit: u64,
    ) -> Result<(Vec<ip_rule::Model>, u64), DbErr> {
        let query = IpRule::find()
            .order_by_asc(ip_rule::Column::Priority)
            .order_by_desc(ip_rule::Column::CreatedAt);
        
        let total = query.clone().count(db).await?;
        let rules = query.offset(offset).limit(limit).all(db).await?;
        
        Ok((rules, total))
    }
    
    /// 获取启用的 IP 规则（按优先级排序）
    pub async fn find_active(db: &DatabaseConnection) -> Result<Vec<ip_rule::Model>, DbErr> {
        IpRule::find()
            .filter(ip_rule::Column::IsActive.eq(true))
            .order_by_asc(ip_rule::Column::Priority)
            .all(db)
            .await
    }
    
    /// 根据 ID 查找 IP 规则
    pub async fn find_by_id(
        db: &DatabaseConnection,
        id: i64,
    ) -> Result<Option<ip_rule::Model>, DbErr> {
        IpRule::find_by_id(id).one(db).await
    }
    
    /// 创建 IP 规则
    pub async fn create(
        db: &DatabaseConnection,
        ip_pattern: String,
        rule_type: ip_rule::IpRuleType,
        description: Option<String>,
        priority: i32,
    ) -> Result<ip_rule::Model, DbErr> {
        let now = chrono::Utc::now();
        
        let rule = ip_rule::ActiveModel {
            ip_pattern: Set(ip_pattern),
            rule_type: Set(rule_type),
            description: Set(description),
            is_active: Set(true),
            priority: Set(priority),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };
        
        rule.insert(db).await
    }
    
    /// 更新 IP 规则
    pub async fn update(
        db: &DatabaseConnection,
        id: i64,
        ip_pattern: Option<String>,
        rule_type: Option<ip_rule::IpRuleType>,
        description: Option<String>,
        is_active: Option<bool>,
        priority: Option<i32>,
    ) -> Result<ip_rule::Model, DbErr> {
        let rule = IpRule::find_by_id(id)
            .one(db)
            .await?
            .ok_or(DbErr::RecordNotFound("IP rule not found".to_string()))?;
        
        let mut active_model: ip_rule::ActiveModel = rule.into();
        
        if let Some(pattern) = ip_pattern {
            active_model.ip_pattern = Set(pattern);
        }
        if let Some(rtype) = rule_type {
            active_model.rule_type = Set(rtype);
        }
        if description.is_some() {
            active_model.description = Set(description);
        }
        if let Some(active) = is_active {
            active_model.is_active = Set(active);
        }
        if let Some(p) = priority {
            active_model.priority = Set(p);
        }
        
        active_model.updated_at = Set(chrono::Utc::now());
        
        active_model.update(db).await
    }
    
    /// 删除 IP 规则
    pub async fn delete(db: &DatabaseConnection, id: i64) -> Result<bool, DbErr> {
        let result = IpRule::delete_by_id(id).exec(db).await?;
        Ok(result.rows_affected > 0)
    }
    
    /// 批量启用/禁用规则
    pub async fn batch_set_active(
        db: &DatabaseConnection,
        ids: Vec<i64>,
        is_active: bool,
    ) -> Result<u64, DbErr> {
        let result = IpRule::update_many()
            .filter(ip_rule::Column::Id.is_in(ids))
            .col_expr(ip_rule::Column::IsActive, Expr::value(is_active))
            .col_expr(ip_rule::Column::UpdatedAt, Expr::value(chrono::Utc::now()))
            .exec(db)
            .await?;
        
        Ok(result.rows_affected)
    }
}

/// User-Agent 规则仓储
pub struct UaRuleRepo;

impl UaRuleRepo {
    /// 获取所有 UA 规则（按优先级排序）
    pub async fn find_all(
        db: &DatabaseConnection,
        offset: u64,
        limit: u64,
    ) -> Result<(Vec<crate::entities::ua_rule::Model>, u64), DbErr> {
        use crate::entities::{ua_rule, UaRule};
        
        let query = UaRule::find()
            .order_by_asc(ua_rule::Column::Priority)
            .order_by_desc(ua_rule::Column::CreatedAt);
        
        let total = query.clone().count(db).await?;
        let rules = query.offset(offset).limit(limit).all(db).await?;
        
        Ok((rules, total))
    }
    
    /// 获取启用的 UA 规则（按优先级排序）
    pub async fn find_active(
        db: &DatabaseConnection,
    ) -> Result<Vec<crate::entities::ua_rule::Model>, DbErr> {
        use crate::entities::{ua_rule, UaRule};
        
        UaRule::find()
            .filter(ua_rule::Column::IsActive.eq(true))
            .order_by_asc(ua_rule::Column::Priority)
            .all(db)
            .await
    }
    
    /// 根据 ID 查找 UA 规则
    pub async fn find_by_id(
        db: &DatabaseConnection,
        id: i64,
    ) -> Result<Option<crate::entities::ua_rule::Model>, DbErr> {
        use crate::entities::UaRule;
        UaRule::find_by_id(id).one(db).await
    }
    
    /// 创建 UA 规则
    pub async fn create(
        db: &DatabaseConnection,
        ua_pattern: String,
        rule_type: crate::entities::ua_rule::UaRuleType,
        description: Option<String>,
        priority: i32,
    ) -> Result<crate::entities::ua_rule::Model, DbErr> {
        use crate::entities::ua_rule;
        
        let now = chrono::Utc::now();
        
        let rule = ua_rule::ActiveModel {
            ua_pattern: Set(ua_pattern),
            rule_type: Set(rule_type),
            description: Set(description),
            is_active: Set(true),
            priority: Set(priority),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };
        
        rule.insert(db).await
    }
    
    /// 更新 UA 规则
    pub async fn update(
        db: &DatabaseConnection,
        id: i64,
        ua_pattern: Option<String>,
        rule_type: Option<crate::entities::ua_rule::UaRuleType>,
        description: Option<String>,
        is_active: Option<bool>,
        priority: Option<i32>,
    ) -> Result<crate::entities::ua_rule::Model, DbErr> {
        use crate::entities::{ua_rule, UaRule};
        
        let rule = UaRule::find_by_id(id)
            .one(db)
            .await?
            .ok_or(DbErr::RecordNotFound("UA rule not found".to_string()))?;
        
        let mut active_model: ua_rule::ActiveModel = rule.into();
        
        if let Some(pattern) = ua_pattern {
            active_model.ua_pattern = Set(pattern);
        }
        if let Some(rtype) = rule_type {
            active_model.rule_type = Set(rtype);
        }
        if description.is_some() {
            active_model.description = Set(description);
        }
        if let Some(active) = is_active {
            active_model.is_active = Set(active);
        }
        if let Some(p) = priority {
            active_model.priority = Set(p);
        }
        
        active_model.updated_at = Set(chrono::Utc::now());
        
        active_model.update(db).await
    }
    
    /// 删除 UA 规则
    pub async fn delete(db: &DatabaseConnection, id: i64) -> Result<bool, DbErr> {
        use crate::entities::UaRule;
        let result = UaRule::delete_by_id(id).exec(db).await?;
        Ok(result.rows_affected > 0)
    }
    
    /// 批量启用/禁用规则
    pub async fn batch_set_active(
        db: &DatabaseConnection,
        ids: Vec<i64>,
        is_active: bool,
    ) -> Result<u64, DbErr> {
        use crate::entities::{ua_rule, UaRule};
        
        let result = UaRule::update_many()
            .filter(ua_rule::Column::Id.is_in(ids))
            .col_expr(ua_rule::Column::IsActive, Expr::value(is_active))
            .col_expr(ua_rule::Column::UpdatedAt, Expr::value(chrono::Utc::now()))
            .exec(db)
            .await?;
        
        Ok(result.rows_affected)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_ip_rule_repo() {
        // 单元测试需要真实数据库连接
        // 这里只测试编译通过
    }
}
