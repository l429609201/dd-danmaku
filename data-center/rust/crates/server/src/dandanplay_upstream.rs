//! 官方上游共享连接及签名；凭据缺失时明确拒绝，不发送匿名回源请求。
use std::sync::OnceLock;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{Client, RequestBuilder};
use sha2::{Digest, Sha256};

static CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();

/// 复用连接池；不将凭据固化在全局客户端中，避免配置变化后继续使用旧签名。
pub fn client() -> Result<Client, String> {
    CLIENT.get_or_init(|| Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build().map_err(|_| "无法创建弹弹上游连接".to_owned())).clone()
}

/// 官方应用身份，与 Rust api_key_pool 的通用 api_key 字段没有隐式映射。
pub struct Credentials {
    pub app_id: String,
    pub app_secret: String,
    pub user_agent: String,
}

impl Credentials {
    pub fn from_env() -> Result<Self, String> {
        let app_id = std::env::var("DANDANPLAY_APP_ID").unwrap_or_default();
        let app_secret = std::env::var("DANDANPLAY_APP_SECRET").unwrap_or_default();
        if app_id.trim().is_empty() || app_secret.trim().is_empty() {
            return Err("未配置弹弹上游应用凭据 DANDANPLAY_APP_ID/DANDANPLAY_APP_SECRET".into());
        }
        let user_agent = std::env::var("DANDANPLAY_USER_AGENT").ok()
            .filter(|s| !s.trim().is_empty()).unwrap_or_else(|| "data-center-rust/0.1.0".into());
        Ok(Self { app_id, app_secret, user_agent })
    }

    /// 签名仅涵盖 pathname，不含查询参数；显式时钟供独立协议测试使用。
    pub fn authorize_at(&self, request: RequestBuilder, path: &str, timestamp: i64) -> Result<RequestBuilder, String> {
        if !path.starts_with("/api/v2/") || path.contains(['?', '#']) {
            return Err("弹弹签名路径必须为不含查询参数的 /api/v2/ 路径".into());
        }
        if self.app_id.trim().is_empty() || self.app_secret.trim().is_empty() {
            return Err("弹弹上游应用凭据为空".into());
        }
        let signature = STANDARD.encode(Sha256::digest(
            format!("{}{timestamp}{path}{}", self.app_id, self.app_secret).as_bytes()));
        Ok(request.header("X-AppId", &self.app_id)
            .header("X-Signature", signature)
            .header("X-Timestamp", timestamp.to_string())
            .header("X-Auth", "1")
            .header("User-Agent", &self.user_agent))
    }
}

/// 发送前生成秒级时间戳；调用方将配置错误映射为 503，网络失败映射为 502。
pub async fn authorize(db: &sea_orm::DatabaseConnection, request: RequestBuilder, path: &str) -> Result<RequestBuilder, String> {
    crate::upstream_config::load_credentials(db).await?
        .authorize_at(request, path, chrono::Utc::now().timestamp())
}
