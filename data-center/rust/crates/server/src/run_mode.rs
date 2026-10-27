use serde::{Deserialize, Serialize};

/// 运行模式配置
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunMode {
    /// Worker 模式 - 作为 CloudFlare 的数据中心
    /// 只启用与 CF 端交互的 API（Worker Bridge、Control API）
    Worker,
    
    /// API 模式 - 作为独立弹幕服务端
    /// 启用 dandanplay 接口和 OAuth 验证服务
    Api,
}

impl RunMode {
    /// 是否是 Worker 模式
    pub fn is_worker(&self) -> bool {
        matches!(self, RunMode::Worker)
    }
    
    /// 是否是 API 模式
    pub fn is_api(&self) -> bool {
        matches!(self, RunMode::Api)
    }
    
    /// 从字符串解析
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "worker" => Some(RunMode::Worker),
            "api" => Some(RunMode::Api),
            _ => None,
        }
    }
    
    /// 获取模式描述
    pub fn description(&self) -> &str {
        match self {
            RunMode::Worker => "Worker 模式 - CloudFlare 数据中心",
            RunMode::Api => "API 模式 - 独立弹幕服务端",
        }
    }
}

impl Default for RunMode {
    fn default() -> Self {
        // 默认使用 Worker 模式
        RunMode::Worker
    }
}

impl std::fmt::Display for RunMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RunMode::Worker => write!(f, "worker"),
            RunMode::Api => write!(f, "api"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_run_mode() {
        assert!(RunMode::Worker.is_worker());
        assert!(!RunMode::Worker.is_api());
        
        assert!(RunMode::Api.is_api());
        assert!(!RunMode::Api.is_worker());
        
        assert_eq!(RunMode::from_str("worker"), Some(RunMode::Worker));
        assert_eq!(RunMode::from_str("api"), Some(RunMode::Api));
        assert_eq!(RunMode::from_str("invalid"), None);
    }
}
