use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// API 密钥池
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "api_key_pool")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    
    /// 密钥名称
    pub name: String,
    
    /// API 密钥（加密存储）
    pub api_key: String,
    
    /// 密钥来源/用途
    pub source: String,
    
    /// 是否启用
    pub is_active: bool,
    
    /// 优先级
    pub priority: i32,
    
    /// 最后使用时间
    pub last_used_at: Option<DateTime>,
    
    /// 使用次数
    pub use_count: i64,
    
    /// 创建时间
    pub created_at: DateTime,
    
    /// 更新时间
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

/// 签名密钥池
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "sign_key_pool")]
pub struct SignKeyModel {
    #[sea_orm(primary_key)]
    pub id: i64,
    
    /// 密钥名称
    pub name: String,
    
    /// 签名密钥
    pub sign_key: String,
    
    /// 密钥用途
    pub purpose: String,
    
    /// 是否启用
    pub is_active: bool,
    
    /// 最后使用时间
    pub last_used_at: Option<DateTime>,
    
    /// 创建时间
    pub created_at: DateTime,
    
    /// 更新时间
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum SignKeyRelation {}

impl ActiveModelBehavior for SignKeyActiveModel {}

/// 用户白名单
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "user_allow_pool")]
pub struct UserAllowModel {
    #[sea_orm(primary_key)]
    pub id: i64,
    
    /// 用户标识（用户名、邮箱或其他唯一标识）
    pub user_identifier: String,
    
    /// 用户类型
    pub user_type: String,
    
    /// 描述
    pub description: Option<String>,
    
    /// 是否启用
    pub is_active: bool,
    
    /// 创建时间
    pub created_at: DateTime,
    
    /// 更新时间
    pub updated_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum UserAllowRelation {}

impl ActiveModelBehavior for UserAllowActiveModel {}

/// OAuth 配置
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "oauth_config")]
pub struct OAuthConfigModel {
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
pub enum OAuthConfigRelation {}

impl ActiveModelBehavior for OAuthConfigActiveModel {}
