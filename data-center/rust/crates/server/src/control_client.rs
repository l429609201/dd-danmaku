//! Worker 模式出站控制客户端（对应 Python `services_v2/control_client.py`）
//!
//! 数据中心主动连接 Cloudflare Worker 的 WebSocket 控制通道，
//! 处理 Worker 下发的 cache/comment/report 等消息，并支持出站 RPC。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::{interval, timeout, Instant};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, info, warn};

use crate::AppState;

const MAX_MESSAGE_SIZE: usize = 8 * 1024 * 1024;
const PING_INTERVAL: Duration = Duration::from_secs(20);
const PING_TIMEOUT: Duration = Duration::from_secs(60);
const OPEN_TIMEOUT: Duration = Duration::from_secs(10);
const DEFAULT_TTL_SECONDS: i64 = 24 * 60 * 60;
const EMPTY_TTL_SECONDS: i64 = 6 * 60 * 60;

/// 控制客户端配置（环境变量）
#[derive(Debug, Clone)]
pub struct ControlConfig {
    pub ws_url: String,
    pub token: Option<String>,
    pub node_id: String,
}

impl ControlConfig {
    /// 读取 `CONTROL_WORKER_WS_URL` / `CONTROL_TOKEN` / `CONTROL_NODE_ID`；未配置 URL 返回 None
    pub fn from_env() -> Option<Self> {
        let ws_url = std::env::var("CONTROL_WORKER_WS_URL").ok()?.trim().to_string();
        if ws_url.is_empty() {
            return None;
        }
        let token = std::env::var("CONTROL_TOKEN").ok().filter(|t| !t.is_empty());
        let node_id = std::env::var("CONTROL_NODE_ID")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "local-node-1".to_string());
        Some(Self { ws_url, token, node_id })
    }

    fn full_url(&self) -> String {
        let sep = if self.ws_url.contains('?') { '&' } else { '?' };
        format!("{}{}node_id={}", self.ws_url, sep, self.node_id)
    }
}

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>;

/// 出站控制客户端
#[derive(Clone)]
pub struct ControlClient {
    config: ControlConfig,
    state: AppState,
    pending: Pending,
    outbound: Arc<Mutex<Option<mpsc::UnboundedSender<Message>>>>,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// 重连退避：min(30, 2^min(n, 5)) 秒
pub fn backoff_secs(reconnect_count: u32) -> u64 {
    std::cmp::min(30, 2u64.pow(reconnect_count.min(5)))
}

impl ControlClient {
    pub fn new(config: ControlConfig, state: AppState) -> Self {
        Self {
            config,
            state,
            pending: Arc::new(Mutex::new(HashMap::new())),
            outbound: Arc::new(Mutex::new(None)),
        }
    }

    /// 后台启动：断线自动重连
    pub fn spawn(self) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move { self.run_forever().await })
    }

    async fn run_forever(self) {
        let mut reconnect_count: u32 = 0;
        loop {
            match self.run_once().await {
                Ok(()) => {
                    info!("🔌 控制通道已关闭，准备重连");
                    reconnect_count = 0;
                }
                Err(e) => warn!("⚠️ 控制通道错误: {e:#}"),
            }
            *self.outbound.lock().await = None;
            self.pending.lock().await.clear();
            let _ = db::ControlNodeRepo::mark_disconnected(&self.state.db, &self.config.node_id, None).await;
            let _ = db::ControlNodeRepo::increment_reconnect_count(&self.state.db, &self.config.node_id).await;
            let delay = backoff_secs(reconnect_count);
            reconnect_count = reconnect_count.saturating_add(1);
            tokio::time::sleep(Duration::from_secs(delay)).await;
        }
    }

    async fn run_once(&self) -> anyhow::Result<()> {
        let url = self.config.full_url();
        let mut request = url.as_str().into_client_request()?;
        if let Some(token) = &self.config.token {
            request.headers_mut().insert("X-Control-Token", HeaderValue::from_str(token)?);
        }
        let mut ws_config = WebSocketConfig::default();
        ws_config.max_message_size = Some(MAX_MESSAGE_SIZE);
        ws_config.max_frame_size = Some(MAX_MESSAGE_SIZE);

        let (ws, _) = timeout(
            OPEN_TIMEOUT,
            tokio_tungstenite::connect_async_with_config(request, Some(ws_config), false),
        )
        .await
        .map_err(|_| anyhow::anyhow!("连接超时"))??;
        info!("✅ 已连接控制通道: node_id={}", self.config.node_id);
        let _ = db::ControlNodeRepo::upsert(
            &self.state.db,
            self.config.node_id.clone(),
            String::new(),
            self.config.ws_url.clone(),
            true,
        )
        .await;

        let (mut sink, mut stream) = ws.split();
        let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
        *self.outbound.lock().await = Some(tx.clone());

        let mut ticker = interval(PING_INTERVAL);
        let mut last_seen = Instant::now();
        let mut ping_sent_at: Option<Instant> = None;

        loop {
            tokio::select! {
                incoming = stream.next() => {
                    let Some(frame) = incoming else { return Ok(()); };
                    last_seen = Instant::now();
                    match frame? {
                        Message::Text(text) => self.dispatch(text.to_string(), tx.clone()),
                        Message::Ping(data) => { let _ = tx.send(Message::Pong(data)); }
                        Message::Pong(_) => {
                            if let Some(sent) = ping_sent_at.take() {
                                let latency = sent.elapsed().as_millis() as i32;
                                let _ = db::ControlNodeRepo::update_heartbeat(&self.state.db, &self.config.node_id, latency).await;
                            }
                        }
                        Message::Close(_) => return Ok(()),
                        _ => {}
                    }
                }
                Some(out) = rx.recv() => { sink.send(out).await?; }
                _ = ticker.tick() => {
                    if last_seen.elapsed() > PING_TIMEOUT {
                        anyhow::bail!("心跳超时");
                    }
                    ping_sent_at = Some(Instant::now());
                    sink.send(Message::Ping(Vec::new().into())).await?;
                }
            }
        }
    }

    fn dispatch(&self, text: String, tx: mpsc::UnboundedSender<Message>) {
        let this = self.clone();
        tokio::spawn(async move {
            let msg: Value = match serde_json::from_str(&text) {
                Ok(v) => v,
                Err(e) => return debug!("ℹ️ 非 JSON 控制消息: {e}"),
            };
            let id = msg.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
            let kind = msg.get("type").and_then(Value::as_str).unwrap_or_default().to_string();
            let payload = msg.get("payload").cloned().unwrap_or(Value::Null);

            if kind.ends_with(".result") {
                if let Some(waiter) = this.pending.lock().await.remove(&id) {
                    let _ = waiter.send(payload);
                }
                return;
            }
            if kind == "ping" {
                let reply = json!({"id": id, "type": "pong", "timestamp": now_ms()});
                let _ = tx.send(Message::Text(reply.to_string().into()));
                return;
            }
            let Some(result) = this.handle(&kind, &payload).await else {
                return debug!("ℹ️ 未知控制消息类型: {kind}");
            };
            let reply = json!({
                "id": id,
                "type": format!("{kind}.result"),
                "timestamp": now_ms(),
                "payload": result,
            });
            let _ = tx.send(Message::Text(reply.to_string().into()));
        });
    }

    /// 处理消息，返回 reply payload；未知类型返回 None
    async fn handle(&self, kind: &str, p: &Value) -> Option<Value> {
        let r = match kind {
            "cache.get" => self.cache_get(p).await,
            "cache.upsert" => self.cache_upsert(p).await,
            "alias.query" => self.alias_query(p).await,
            "stats.report" => self.stats_report(p).await,
            "log.report" => self.log_report(p).await,
            "abuse.report" => self.abuse_report(p).await,
            "metrics.report" => self.store_report("worker_metrics", p).await,
            "keypool.report" => self.store_report("worker_keypool", p).await,
            "comment.archive" => self.comment_archive(p).await,
            "comment.get" => self.comment_get(p).await,
            _ => return None,
        };
        Some(r.unwrap_or_else(|e| {
            warn!("⚠️ 处理 {kind} 失败: {e:#}");
            json!({"success": false, "error": e.to_string()})
        }))
    }

    async fn cache_get(&self, p: &Value) -> anyhow::Result<Value> {
        let key = str_field(p, "cache_key");
        if key.is_empty() {
            return Ok(json!({"hit": false}));
        }
        Ok(match self.state.cache.get(key).await? {
            Some(c) => json!({
                "hit": true,
                "status": c.status_code,
                "headers": {"content-type": "application/json; charset=utf-8"},
                "body": c.body,
                "cached_at": now_ms(),
                "stale": false,
                "served_stale": false,
            }),
            None => json!({"hit": false}),
        })
    }

    async fn cache_upsert(&self, p: &Value) -> anyhow::Result<Value> {
        let key = str_field(p, "cache_key");
        if key.is_empty() {
            return Ok(json!({"success": false}));
        }
        let body = str_field(p, "body");
        let status = p.get("status").and_then(Value::as_i64).unwrap_or(200) as i32;
        let is_empty = p.get("is_empty").and_then(Value::as_bool).unwrap_or(false);
        let ttl = p.get("ttl").and_then(Value::as_i64).filter(|t| *t > 0).unwrap_or(
            if is_empty { EMPTY_TTL_SECONDS } else { DEFAULT_TTL_SECONDS },
        );
        self.state.cache.set(key, body, status, ttl).await?;
        Ok(json!({"success": true}))
    }

    async fn alias_query(&self, p: &Value) -> anyhow::Result<Value> {
        let keyword = str_field(p, "keyword").trim();
        if keyword.is_empty() {
            return Ok(json!({"success": false, "data": []}));
        }
        let rows = db::AnimeRepo::new(self.state.db.clone()).search_by_title(keyword, 20).await?;
        let data: Vec<Value> = rows
            .into_iter()
            .map(|a| json!({
                "animeId": a.upstream_anime_id,
                "animeTitle": a.title,
                "type": a.type_code,
                "typeDescription": a.type_description,
                "imageUrl": a.image_url,
                "episodeCount": a.episode_count,
            }))
            .collect();
        Ok(json!({"success": true, "data": data}))
    }

    async fn stats_report(&self, p: &Value) -> anyhow::Result<Value> {
        let mut saved = 0;
        for item in array_field(p, "ip_stats") {
            let ip = str_field(item, "ip");
            if ip.is_empty() {
                continue;
            }
            let paths = item.get("paths").map(Value::to_string).unwrap_or_default();
            let total = item.get("total_count").and_then(Value::as_i64).unwrap_or(0) as i32;
            db::IpStatsRepo::create(
                &self.state.db,
                ip.to_string(),
                paths,
                "WORKER".to_string(),
                0,
                None,
                Some(total),
            )
            .await?;
            saved += 1;
        }
        Ok(json!({"success": true, "saved": saved}))
    }

    async fn log_report(&self, p: &Value) -> anyhow::Result<Value> {
        let worker_id = worker_id(p);
        let mut saved = 0;
        for item in array_field(p, "logs") {
            let level = item.get("level").and_then(Value::as_str).unwrap_or("info").to_string();
            let message = str_field(item, "message").to_string();
            let extra = item.get("data").filter(|d| !d.is_null()).map(Value::to_string);
            db::WorkerLogRepo::create(&self.state.db, Some(worker_id.clone()), level, message, extra).await?;
            saved += 1;
        }
        Ok(json!({"success": true, "saved": saved}))
    }

    async fn abuse_report(&self, p: &Value) -> anyhow::Result<Value> {
        let existing: Vec<String> = db::IpRuleRepo::find_active(&self.state.db)
            .await?
            .into_iter()
            .map(|r| r.ip_pattern)
            .collect();
        let mut changed = 0;
        for item in array_field(p, "banned") {
            let ip = str_field(item, "ip");
            if ip.is_empty() || existing.iter().any(|e| e == ip) {
                continue;
            }
            let until = item.get("banned_until").map(Value::to_string).unwrap_or_default();
            db::IpRuleRepo::create(
                &self.state.db,
                ip.to_string(),
                db::entities::ip_rule::IpRuleType::Deny,
                Some(format!("worker abuse ban, until={until}")),
                0,
            )
            .await?;
            changed += 1;
        }
        Ok(json!({"success": true, "changed": changed}))
    }

    /// metrics / keypool 报告按 worker_id 存入配置表
    async fn store_report(&self, namespace: &str, p: &Value) -> anyhow::Result<Value> {
        db::ConfigRepo::set(&self.state.db, namespace, &worker_id(p), &p.to_string(), None).await?;
        Ok(json!({"success": true}))
    }

    async fn comment_archive(&self, p: &Value) -> anyhow::Result<Value> {
        let episode_id = str_field(p, "episode_id");
        let body = str_field(p, "body");
        let source = p.get("source").and_then(Value::as_str).unwrap_or("r2_archive");
        let new_count = serde_json::from_str::<db::DanmakuResponse>(body)
            .map(|r| r.comments.len())
            .unwrap_or(0);
        if episode_id.is_empty() || new_count == 0 {
            return Ok(json!({"saved": false, "reason": "empty"}));
        }
        let store = &self.state.comment_store;
        if let Some(old) = store.get(episode_id).await? {
            if new_count < old.comments.len() {
                return Ok(json!({
                    "saved": false, "reason": "fewer_comments",
                    "old": old.comments.len(), "new": new_count,
                }));
            }
        }
        store.archive(episode_id, body, source).await?;
        Ok(json!({"saved": true, "comment_count": new_count, "size": body.len()}))
    }

    async fn comment_get(&self, p: &Value) -> anyhow::Result<Value> {
        let episode_id = str_field(p, "episode_id");
        Ok(match self.state.comment_store.get(episode_id).await? {
            Some(r) => json!({
                "hit": true,
                "comment_count": r.comments.len(),
                "body": serde_json::to_string(&r)?,
            }),
            None => json!({"hit": false}),
        })
    }

    /// 出站 RPC：向 Worker 发送请求并等待 `<type>.result`
    pub async fn request(&self, kind: &str, payload: Value, wait: Duration) -> anyhow::Result<Value> {
        let tx = self.outbound.lock().await.clone().ok_or_else(|| anyhow::anyhow!("控制通道未连接"))?;
        let id = uuid::Uuid::new_v4().to_string();
        let (done, recv) = oneshot::channel();
        self.pending.lock().await.insert(id.clone(), done);
        let msg = json!({"id": id, "type": kind, "timestamp": now_ms(), "payload": payload});
        if tx.send(Message::Text(msg.to_string().into())).is_err() {
            self.pending.lock().await.remove(&id);
            anyhow::bail!("控制通道已断开");
        }
        match timeout(wait, recv).await {
            Ok(Ok(v)) => Ok(v),
            _ => {
                self.pending.lock().await.remove(&id);
                anyhow::bail!("{kind} 请求超时")
            }
        }
    }

    /// 从 Worker 的 R2 读取弹幕归档
    pub async fn r2_comment_get(&self, episode_id: &str) -> anyhow::Result<Value> {
        let payload = json!({"episode_id": episode_id, "r2_key": format!("comment/{episode_id}")});
        self.request("r2.comment.get", payload, Duration::from_secs(3)).await
    }

    /// 导出 Worker Durable Object 配置
    pub async fn dump_do_config(&self) -> anyhow::Result<Value> {
        self.request("config.dump", json!({}), Duration::from_secs(5)).await
    }
}

fn str_field<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or_default()
}

fn array_field<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}

fn worker_id(p: &Value) -> String {
    p.get("worker_id").and_then(Value::as_str).unwrap_or("worker-1").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_backoff() {
        assert_eq!(backoff_secs(0), 1);
        assert_eq!(backoff_secs(3), 8);
        assert_eq!(backoff_secs(5), 30);
        assert_eq!(backoff_secs(20), 30);
    }

    #[test]
    fn test_full_url() {
        let c = ControlConfig { ws_url: "wss://w.example/ctl".into(), token: None, node_id: "n1".into() };
        assert_eq!(c.full_url(), "wss://w.example/ctl?node_id=n1");
        let c = ControlConfig { ws_url: "wss://w.example/ctl?a=1".into(), ..c };
        assert_eq!(c.full_url(), "wss://w.example/ctl?a=1&node_id=n1");
    }
}
