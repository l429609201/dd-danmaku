//! dandanplay API 客户端

use crate::http_client::{SimpleHttpClient, HttpError};
use serde::{Deserialize, Serialize};

/// dandanplay API 客户端
pub struct DandanplayClient {
    pub http_client: SimpleHttpClient,
    base_url: String,
}

impl DandanplayClient {
    /// 创建新的 dandanplay API 客户端
    pub fn new() -> Self {
        Self {
            http_client: SimpleHttpClient::new(),
            base_url: "https://api.dandanplay.net".to_string(),
        }
    }

    /// 获取弹幕
    /// 
    /// 调用 `/api/v2/comment/{episode_id}` 端点
    pub async fn get_comments(&self, episode_id: &str) -> Result<CommentApiResponse, DandanplayError> {
        let url = format!("{}/api/v2/comment/{}", self.base_url, episode_id);
        
        let body = self.http_client.get(&url)
            .await
            .map_err(DandanplayError::Http)?;

        serde_json::from_str(&body).map_err(|e| DandanplayError::Parse(e.to_string()))
    }
}

/// 弹幕 API 响应（dandanplay 官方格式）
#[derive(Debug, Deserialize, Serialize)]
pub struct CommentApiResponse {
    pub count: i32,
    pub comments: Vec<CommentItem>,
}

/// 弹幕项（dandanplay 官方格式）
#[derive(Debug, Deserialize, Serialize)]
pub struct CommentItem {
    #[serde(rename = "cid")]
    pub id: i64,
    #[serde(rename = "p")]
    pub position: String,
    #[serde(rename = "m")]
    pub message: String,
}

#[derive(Debug, Clone)]
pub enum DandanplayError {
    Http(HttpError),
    Parse(String),
    NotFound,
}

impl std::fmt::Display for DandanplayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Http(e) => write!(f, "HTTP error: {}", e),
            Self::Parse(msg) => write!(f, "Parse error: {}", msg),
            Self::NotFound => write!(f, "Comments not found"),
        }
    }
}

impl std::error::Error for DandanplayError {}

impl From<HttpError> for DandanplayError {
    fn from(e: HttpError) -> Self {
        match &e {
            HttpError::StatusCode(404) => Self::NotFound,
            _ => Self::Http(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore] // 需要网络连接
    async fn test_get_comments_real_api() {
        let client = DandanplayClient::new();
        // 使用一个已知的 episode_id 测试
        let result = client.get_comments("123456").await;
        // 这个测试可能失败（404），但不应该是解析错误
        match result {
            Ok(_) => println!("Got comments"),
            Err(DandanplayError::NotFound) => println!("Episode not found (expected)"),
            Err(e) => panic!("Unexpected error: {}", e),
        }
    }
}
