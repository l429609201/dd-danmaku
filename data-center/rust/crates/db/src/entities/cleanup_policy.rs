use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// 数据清理策略
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "cleanup_policies")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    
    /// 策略名称
    pub name: String,
    
    /// 目标表名
    pub target_table: String,
    
    /// 清理条件（SQL WHERE 子句）
    pub condition: String,
    
    /// 保留天数
    pub retention_days: i32,
    
    /// 是否启用
    pub is_active: bool,
    
    /// 执行频率（cron 表达式）
    pub schedule: String,
    
    /// 最后执行时间
    pub last_run_at: Option<DateTime>,
    
    /// 最后清理数量
    pub last_cleanup_count: Option<i64>,
    
    /// 创建时间
    pub created_at: DateTime,
    
    /// 更新时间
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
