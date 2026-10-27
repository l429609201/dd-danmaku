//! 简单的 HTTP 客户端（基于 hyper，零新依赖）

use http_body_util::BodyExt;
use hyper::Request;
use hyper_util::client::legacy::Client;
use hyper_util::rt::TokioExecutor;
use std::time::Duration;

/// 简单的 HTTP 客户端
pub struct SimpleHttpClient {
    client: Client<hyper_util::client::legacy::connect::HttpConnector, http_body_util::Empty<bytes::Bytes>>,
    timeout: Duration,
}

impl SimpleHttpClient {
    /// 创建新的 HTTP 客户端
    pub fn new() -> Self {
        let client = Client::builder(TokioExecutor::new()).build_http();
        Self {
            client,
            timeout: Duration::from_secs(30),
        }
    }

    /// GET 请求，返回响应体字符串
    pub async fn get(&self, url: &str) -> Result<String, HttpError> {
        let uri: hyper::Uri = url.parse().map_err(|_| HttpError::InvalidUrl)?;
        
        let req = Request::builder()
            .method("GET")
            .uri(uri)
            .header("User-Agent", "data-center-rust/0.1.0")
            .body(http_body_util::Empty::<bytes::Bytes>::new())
            .map_err(|_| HttpError::RequestBuild)?;

        let response = tokio::time::timeout(self.timeout, self.client.request(req))
            .await
            .map_err(|_| HttpError::Timeout)?
            .map_err(|e| HttpError::Network(e.to_string()))?;

        let status = response.status();
        if !status.is_success() {
            return Err(HttpError::StatusCode(status.as_u16()));
        }

        // 读取响应体
        let body_bytes = response
            .into_body()
            .collect()
            .await
            .map_err(|e| HttpError::Network(e.to_string()))?
            .to_bytes();

        String::from_utf8(body_bytes.to_vec()).map_err(|_| HttpError::InvalidUtf8)
    }
}

#[derive(Debug, Clone)]
pub enum HttpError {
    InvalidUrl,
    RequestBuild,
    Timeout,
    Network(String),
    StatusCode(u16),
    InvalidUtf8,
}

impl std::fmt::Display for HttpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidUrl => write!(f, "Invalid URL"),
            Self::RequestBuild => write!(f, "Failed to build request"),
            Self::Timeout => write!(f, "Request timeout"),
            Self::Network(msg) => write!(f, "Network error: {}", msg),
            Self::StatusCode(code) => write!(f, "HTTP status code: {}", code),
            Self::InvalidUtf8 => write!(f, "Response body is not valid UTF-8"),
        }
    }
}

impl std::error::Error for HttpError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore] // 需要网络连接
    async fn test_http_client_basic() {
        let client = SimpleHttpClient::new();
        // 测试一个稳定的公共 API
        let result = client.get("https://httpbin.org/status/200").await;
        assert!(result.is_ok());
    }
}
