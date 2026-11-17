use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// IP 规则类型
#[derive(Debug, Clone, PartialEq, Eq, EnumIter, DeriveActiveEnum, Serialize, Deserialize)]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::N(20))")]
pub enum IpRuleType {
    #[sea_orm(string_value = "allow")]
    Allow,
    #[sea_orm(string_value = "deny")]
    Deny,
}

/// IP 规则
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "ip_rules")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    
    /// IP 地址或 CIDR（例如：192.168.1.1 或 192.168.0.0/24）
    pub ip_pattern: String,
    
    /// 规则类型：allow, deny
    pub rule_type: IpRuleType,
    
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
    fn test_ip_rule_model() {
        let rule = Model {
            id: 1,
            ip_pattern: "192.168.1.1".to_string(),
            rule_type: IpRuleType::Allow,
            description: Some("测试 IP".to_string()),
            is_active: true,
            priority: 10,
            created_at: chrono::Utc::now().naive_utc(),
            updated_at: chrono::Utc::now().naive_utc(),
        };
        
        assert_eq!(rule.ip_pattern, "192.168.1.1");
        assert_eq!(rule.rule_type, IpRuleType::Allow);
    }
}
