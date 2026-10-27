use serde::{Deserialize, Serialize};

/// dandanplay 匹配请求
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchRequest {
    /// 文件名
    pub file_name: String,
    /// 文件哈希（可选）
    pub file_hash: Option<String>,
    /// 文件大小（可选）
    pub file_size: Option<u64>,
    /// 视频时长（可选，秒）
    pub video_duration: Option<f64>,
    /// 匹配模式（可选）
    pub match_mode: Option<String>,
}

/// dandanplay 匹配响应
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchResponse {
    /// 是否成功
    pub success: bool,
    /// 错误信息
    pub error_message: Option<String>,
    /// 匹配结果
    pub matches: Vec<MatchResult>,
}

/// 匹配结果项
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchResult {
    /// 剧集 ID
    pub episode_id: i32,
    /// 番剧标题
    pub anime_title: String,
    /// 剧集标题
    pub episode_title: String,
    /// 剧集类型
    pub type_description: String,
    /// 匹配度（0-1）
    pub shift: f64,
}

/// 弹幕响应
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentResponse {
    /// 弹幕数量
    pub count: i32,
    /// 弹幕列表
    pub comments: Vec<Comment>,
}

/// 弹幕项
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    /// 弹幕 ID
    #[serde(rename = "cid")]
    pub id: i64,
    /// 出现时间（秒）
    #[serde(rename = "p")]
    pub position: String,
    /// 弹幕内容
    #[serde(rename = "m")]
    pub message: String,
}

/// 第三方弹幕请求
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtCommentRequest {
    /// 弹幕源 URL
    pub url: String,
}

/// 第三方弹幕响应
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtCommentResponse {
    /// 弹幕数量
    pub count: i32,
    /// 弹幕列表
    pub comments: Vec<Comment>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_match_request_deserialize() {
        let json = r#"{
            "fileName": "test.mp4",
            "fileHash": "abc123",
            "fileSize": 1024000,
            "videoDuration": 1440.5
        }"#;
        
        let req: MatchRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.file_name, "test.mp4");
        assert_eq!(req.file_hash, Some("abc123".to_string()));
        assert_eq!(req.file_size, Some(1024000));
    }

    #[test]
    fn test_match_response_serialize() {
        let resp = MatchResponse {
            success: true,
            error_message: None,
            matches: vec![
                MatchResult {
                    episode_id: 12345,
                    anime_title: "测试番剧".to_string(),
                    episode_title: "第1集".to_string(),
                    type_description: "TV".to_string(),
                    shift: 0.95,
                }
            ],
        };
        
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"episodeId\":12345"));
    }

    #[test]
    fn test_comment_serialize() {
        let comment = Comment {
            id: 1001,
            position: "123.45,1,25,0xffffff,1234567890".to_string(),
            message: "测试弹幕".to_string(),
        };
        
        let json = serde_json::to_string(&comment).unwrap();
        assert!(json.contains("\"cid\":1001"));
        assert!(json.contains("\"p\":"));
        assert!(json.contains("\"m\":"));
    }
}
