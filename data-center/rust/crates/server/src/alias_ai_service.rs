use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn, error};

/// AI 打分结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiSuggestion {
    pub match_index: u32,
    pub confidence: u32,  // 0-100
    pub reason: String,
}

/// AI 打分任务状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoringStatus {
    pub running: bool,
    pub processed: u32,
    pub succeeded: u32,
    pub failed: u32,
    pub total: u32,
    pub message: String,
}

/// AI 打分响应
#[derive(Debug, Serialize, Deserialize)]
pub struct ScoringResult {
    pub started: bool,
    pub status: ScoringStatus,
}

/// OpenAI 兼容的 API 请求
#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<Message>,
    temperature: f32,
    max_tokens: u32,
}

#[derive(Debug, Serialize)]
struct Message {
    role: String,
    content: String,
}

/// OpenAI 兼容的 API 响应
#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: MessageContent,
}

#[derive(Debug, Deserialize)]
struct MessageContent {
    content: String,
}

/// 别名 AI 辅助服务
/// 
/// 功能：
/// - 低置信度别名候选 AI 打分（OpenAI 兼容接口）
/// - 只提供建议不自动上线（写 ai_suggestion 字段）
/// - 支持 OpenAI / DeepSeek / 通义 / 本地 vLLM
/// - 异步批量处理
pub struct AliasAiService {
    client: reqwest::Client,
    status: Arc<RwLock<ScoringStatus>>,
}

impl AliasAiService {
    /// 创建 AI 服务
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
            status: Arc::new(RwLock::new(ScoringStatus {
                running: false,
                processed: 0,
                succeeded: 0,
                failed: 0,
                total: 0,
                message: "未开始".to_string(),
            })),
        }
    }
    
    /// 获取配置
    fn get_config() -> Option<AiConfig> {
        let enabled = std::env::var("AI_ENABLED")
            .ok()
            .and_then(|s| s.parse::<bool>().ok())
            .unwrap_or(false);
        
        if !enabled {
            return None;
        }
        
        let api_url = std::env::var("AI_API_URL").ok()?;
        let api_key = std::env::var("AI_API_KEY").ok()?;
        let model = std::env::var("AI_MODEL")
            .unwrap_or_else(|_| "gpt-3.5-turbo".to_string());
        
        Some(AiConfig {
            api_url,
            api_key,
            model,
        })
    }
    
    /// 开始打分任务
    pub async fn start_scoring(
        &self,
        db: sea_orm::DatabaseConnection,
        max_calls: Option<u32>,
    ) -> ScoringResult {
        // 检查是否已在运行
        {
            let status = self.status.read().await;
            if status.running {
                return ScoringResult {
                    started: false,
                    status: status.clone(),
                };
            }
        }
        
        // 检查配置
        let config = match Self::get_config() {
            Some(c) => c,
            None => {
                let status = ScoringStatus {
                    running: false,
                    processed: 0,
                    succeeded: 0,
                    failed: 0,
                    total: 0,
                    message: "AI 服务未启用或配置不完整".to_string(),
                };
                return ScoringResult {
                    started: false,
                    status,
                };
            }
        };
        
        // 启动后台任务
        let status_clone = Arc::clone(&self.status);
        let client = self.client.clone();
        
        tokio::spawn(async move {
            Self::run_scoring_task(db, client, config, status_clone, max_calls).await;
        });
        
        // 等待任务启动
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        
        let status = self.status.read().await.clone();
        ScoringResult {
            started: true,
            status,
        }
    }
    
    /// 获取打分状态
    pub async fn get_status(&self) -> ScoringStatus {
        self.status.read().await.clone()
    }
    
    /// 执行打分任务
    async fn run_scoring_task(
        db: sea_orm::DatabaseConnection,
        client: reqwest::Client,
        config: AiConfig,
        status: Arc<RwLock<ScoringStatus>>,
        max_calls: Option<u32>,
    ) {
        use sea_orm::*;
        
        // 更新状态：开始
        {
            let mut s = status.write().await;
            s.running = true;
            s.message = "正在查询待打分别名...".to_string();
        }
        
        // 查询低置信度的 pending 别名（假设有 anime_alias 表）
        // 这里简化处理，实际需要根据数据库结构调整
        info!("🤖 AI 打分任务开始");
        
        // TODO: 实际查询逻辑
        // let aliases = anime_alias::Entity::find()
        //     .filter(anime_alias::Column::Status.eq("pending"))
        //     .filter(anime_alias::Column::Confidence.lt(70))
        //     .order_by_desc(anime_alias::Column::HitCount)
        //     .limit(max_calls.unwrap_or(50))
        //     .all(&db)
        //     .await?;
        
        // 模拟处理（实际需要替换为真实逻辑）
        let total = max_calls.unwrap_or(10);
        {
            let mut s = status.write().await;
            s.total = total;
            s.message = format!("找到 {} 个待打分别名", total);
        }
        
        for i in 0..total {
            // 更新进度
            {
                let mut s = status.write().await;
                s.processed = i + 1;
                s.message = format!("正在处理 {}/{}", i + 1, total);
            }
            
            // TODO: 调用 AI API 打分
            // let suggestion = Self::call_ai_api(&client, &config, &alias).await;
            
            // 模拟延迟
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            
            // 更新成功计数
            {
                let mut s = status.write().await;
                s.succeeded += 1;
            }
        }
        
        // 完成
        {
            let mut s = status.write().await;
            s.running = false;
            s.message = format!("打分完成: 成功 {}, 失败 {}", s.succeeded, s.failed);
        }
        
        info!("✅ AI 打分任务完成");
    }
    
    /// 调用 AI API
    #[allow(dead_code)]
    async fn call_ai_api(
        client: &reqwest::Client,
        config: &AiConfig,
        query_title: &str,
        candidate_titles: &[String],
    ) -> Result<AiSuggestion, String> {
        let prompt = Self::build_prompt(query_title, candidate_titles);
        
        let request = ChatRequest {
            model: config.model.clone(),
            messages: vec![Message {
                role: "user".to_string(),
                content: prompt,
            }],
            temperature: 0.1,
            max_tokens: 200,
        };
        
        let response = client
            .post(&config.api_url)
            .header("Authorization", format!("Bearer {}", config.api_key))
            .json(&request)
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| format!("API 请求失败: {}", e))?;
        
        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("API 返回错误 {}: {}", status, text));
        }
        
        let chat_response: ChatResponse = response
            .json()
            .await
            .map_err(|e| format!("解析响应失败: {}", e))?;
        
        let content = chat_response
            .choices
            .first()
            .ok_or_else(|| "响应无 choices".to_string())?
            .message
            .content
            .trim();
        
        // 解析 JSON 响应
        serde_json::from_str::<AiSuggestion>(content)
            .map_err(|e| format!("解析 AI 建议失败: {}", e))
    }
    
    /// 构建 AI Prompt
    fn build_prompt(query: &str, candidates: &[String]) -> String {
        let candidates_text = candidates
            .iter()
            .enumerate()
            .map(|(i, title)| format!("{}. {}", i + 1, title))
            .collect::<Vec<_>>()
            .join("\n");
        
        format!(
            r#"用户搜索「{}」，以下是候选番剧：
{}

请判断哪个候选最匹配用户搜索：
- 季度后缀「II」「2nd」等表示同作品不同季
- 若都不匹配，match_index 返回 0
- confidence 是 0-100 的置信度
- reason 是简短中文理由

只输出 JSON，不要解释：
{{"match_index": 数字, "confidence": 0-100, "reason": "理由"}}"#,
            query, candidates_text
        )
    }
}

struct AiConfig {
    api_url: String,
    api_key: String,
    model: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_get_config_disabled() {
        std::env::set_var("AI_ENABLED", "false");
        assert!(AliasAiService::get_config().is_none());
    }
    
    #[test]
    fn test_build_prompt() {
        let prompt = AliasAiService::build_prompt(
            "进击的巨人",
            &["进击的巨人".to_string(), "进击的巨人 第二季".to_string()],
        );
        assert!(prompt.contains("用户搜索「进击的巨人」"));
        assert!(prompt.contains("1. 进击的巨人"));
    }
}
