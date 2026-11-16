use axum::{body::Body, extract::{Request, State}, http::{header, Method, StatusCode}, response::{IntoResponse, Response}};
use std::path::{Path, PathBuf};
use tower_http::services::ServeDir;

/// 前端与 API 共用端口；部署目录与 Dockerfile 的复制位置保持一致。
pub fn directory() -> PathBuf {
    std::env::var_os("WEB_DIST_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/app/web/dist"))
}

/// 只为页面导航回退到入口，不把未知 API、资源或写请求伪装为 HTML。
pub async fn serve(State(directory): State<PathBuf>, request: Request) -> Response {
    let path = request.uri().path().to_string();
    if path == "/api" || path.starts_with("/api/") || path == "/health" || path.starts_with("/health/") {
        return StatusCode::NOT_FOUND.into_response();
    }
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    let head = request.method() == Method::HEAD;
    let navigation = path == "/" || (
        !path.starts_with("/assets/")
        && Path::new(&path).extension().is_none()
        && request.headers().get(header::ACCEPT)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.split(',').any(|item| item.trim().starts_with("text/html")))
    );
    let mut files = ServeDir::new(&directory);
    let mut response = match files.try_call(request).await {
        Ok(response) => response.map(Body::new),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    if response.status().is_success() && (path == "/" || path == "/index.html") {
        response.headers_mut().insert(header::CACHE_CONTROL, "no-cache".parse().unwrap());
    }
    if response.status() != StatusCode::NOT_FOUND || !navigation {
        return response;
    }
    // 入口不长缓存，发布后重新读取指纹化资源；HEAD 不发送正文。
    match tokio::fs::read(directory.join("index.html")).await {
        Ok(html) => (
            [(header::CONTENT_TYPE, "text/html; charset=utf-8"), (header::CACHE_CONTROL, "no-cache")],
            if head { Body::empty() } else { Body::from(html) },
        ).into_response(),
        Err(_) => (StatusCode::SERVICE_UNAVAILABLE, "管理页面资源未就绪，请检查 WEB_DIST_DIR 中的前端构建产物。").into_response(),
    }
}
