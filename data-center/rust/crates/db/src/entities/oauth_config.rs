use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// OAuth 配置
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "oauth_config")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    
    /// 提供商名称（github, google, wechat 等）
    pub provider: String,
    
    /// Client ID
    pub client_id: String,
    
    /// Client Secret（加密存储）
    pub client_secret: String,
    
    /// 回调 URL
    pub redirect_uri: String,
    
    /// 授权范围
    pub scope: Option<String>,
    
    /// 是否启用
    pub is_active: bool,
    
    /// 创建时间
    pub created_at: DateTime,
    
    /// 更新时间
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
