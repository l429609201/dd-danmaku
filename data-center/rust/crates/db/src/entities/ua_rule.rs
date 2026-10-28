use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// User-Agent 规则类型
#[derive(Debug, Clone, PartialEq, Eq, EnumIter, DeriveActiveEnum, Serialize, Deserialize)]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::N(20))")]
pub enum UaRuleType {
    #[sea_orm(string_value = "allow")]
    Allow,
    #[sea_orm(string_value = "deny")]
    Deny,
}

/// User-Agent 规则
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "ua_rules")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    
    /// UA 匹配模式（支持通配符或正则表达式）
    pub ua_pattern: String,
    
    /// 规则类型：allow, deny
    pub rule_type: UaRuleType,
    
    /// 描述
    pub description: Option<String>,
    
    /// 是否启用
    pub is_active: bool,
    
    /// 优先级（数字越小优先级越高）
    pub priority: i32,
    
    /// 创建时间
    pub created_at: DateTime,
    
    /// 更新时间
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_ua_rule_model() {
        let rule = Model {
            id: 1,
            ua_pattern: "Mozilla/*".to_string(),
            rule_type: UaRuleType::Allow,
            description: Some("允许 Mozilla 浏览器".to_string()),
            is_active: true,
            priority: 10,
            created_at: chrono::Utc::now().naive_utc(),
            updated_at: chrono::Utc::now().naive_utc(),
        };
        
        assert_eq!(rule.ua_pattern, "Mozilla/*");
        assert_eq!(rule.rule_type, UaRuleType::Allow);
    }
}
