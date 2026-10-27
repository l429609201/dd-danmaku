# 阶段 0：Worker WebSocket 协议契约

> 状态：进行中 | 创建时间：2026-10-27

## 1. 连接与鉴权

### 1.1 连接参数

- **URL**：从 `CONTROL_WORKER_WS_URL` 配置读取
- **Query 参数**：`node_id={CONTROL_NODE_ID}`
- **请求头**：`X-Control-Token: {CONTROL_TOKEN}`
- **连接方向**：data-center → Worker ControlHub（主动连接）

### 1.2 生命周期

- **自动重连**：连接断开时按退避策略重连
- **心跳**：`ping` / `pong` 消息（间隔待确认）
- **状态记录**：连接状态写入 `control_nodes` 表

---

## 2. 消息格式

所有消息采用 JSON 格式，包含以下字段：

```json
{
  "id": "消息唯一标识（UUID）",
  "type": "消息类型",
  "timestamp": "Unix 时间戳（秒）",
  "payload": { /* 消息体 */ }
}
```

### 2.1 RPC 请求/响应模式

- **请求**：`type` 为操作名（如 `cache.get`）
- **响应**：`type` 为 `{操作名}.result`（如 `cache.get.result`）
- **关联**：通过消息 `id` 匹配请求与响应
- **超时**：本地发起的 RPC 有超时机制（待确认超时值）

---

## 3. Worker → data-center 消息类型

### 3.1 缓存查询：`cache.get`

**用途**：Worker 内存缓存未命中时查询本地数据库缓存

**Payload 字段**：
```json
{
  "cache_key": "缓存键",
  "worker_request_id": "Worker 请求 ID（可选）",
  "client_ip": "客户端 IP（可选）",
  "prefetch": false,  // true = 预查（不记录 miss 日志）
  "allow_stale": false,  // true = 允许返回过期数据
  "alias_only": false  // true = 只解析别名，不读缓存体
}
```

**响应**：`cache.get.result`
```json
{
  "hit": true/false,
  "is_empty": false,  // 负缓存标识
  "data": { /* 缓存数据 */ },
  "canonical": "规范词（如有别名映射）"
}
```

### 3.2 缓存更新：`cache.upsert`

**用途**：Worker 回源成功后写入本地缓存

**Payload 字段**：
```json
{
  "cache_key": "缓存键",
  "response_body": "响应体（JSON 字符串或对象）",
  "worker_request_id": "Worker 请求 ID（可选）"
}
```

**响应**：`cache.upsert.result`（成功/失败）

### 3.3 别名查询：`alias.query`

**用途**：查询搜索词的规范别名

**Payload 字段**：
```json
{
  "query": "搜索词"
}
```

**响应**：`alias.query.result`
```json
{
  "canonical": "规范词",
  "approved": true/false
}
```

### 3.4 统计上报：`stats.report`

**用途**：Worker 上报 IP 请求统计

**Payload 字段**：
```json
{
  "records": [
    {
      "ip_hash": "IP 哈希",
      "endpoint": "端点",
      "count": 123
    }
  ]
}
```

### 3.5 日志上报：`log.report`

**用途**：Worker 上报运行日志

**Payload 字段**：
```json
{
  "worker_id": "Worker 实例 ID",
  "log_level": "info/warn/error",
  "message": "日志内容",
  "context": { /* 上下文 */ }
}
```

### 3.6 滥用上报：`abuse.report`

**用途**：Worker 上报恶意 IP/UA

**Payload 字段**：
```json
{
  "ip": "IP 地址",
  "ua": "User-Agent",
  "reason": "封禁原因",
  "duration": 3600  // 封禁时长（秒）
}
```

**副作用**：触发本地端防抖后批量下发封禁配置到 Worker

### 3.7 指标上报：`metrics.report`

**用途**：Worker 上报性能指标

**Payload 字段**：
```json
{
  "worker_id": "Worker 实例 ID",
  "metrics": {
    "requests_total": 12345,
    "cache_hit_rate": 0.85,
    "avg_latency_ms": 123.45
  }
}
```

### 3.8 密钥池上报：`keypool.report`

**用途**：Worker 上报密钥池状态

**Payload 字段**：
```json
{
  "worker_id": "Worker 实例 ID",
  "keys": [
    {
      "key_id": "密钥 ID",
      "status": "active/expired",
      "usage_count": 123
    }
  ]
}
```

### 3.9 弹幕归档：`comment.archive`

**用途**：Worker 请求归档弹幕到 R2/本地存储

**Payload 字段**：待确认

### 3.10 弹幕查询：`comment.get`

**用途**：Worker 请求获取弹幕数据

**Payload 字段**：待确认

### 3.11 心跳：`ping`

**用途**：Worker 发起心跳检测

**响应**：`pong`（立即返回）

---

## 4. data-center → Worker 消息类型

### 4.1 配置下发：`config.apply`

**用途**：下发封禁规则、限流配置等

**Payload 字段**：
```json
{
  "config_version": "配置版本号",
  "ip_rules": [ /* IP 黑白名单 */ ],
  "ua_rules": [ /* UA 限流规则 */ ],
  "key_pool": [ /* 密钥池配置 */ ]
}
```

### 4.2 RPC 请求

本地可主动向 Worker 发起的 RPC（待补充）：
- `r2.comment.get`：从 Worker R2 binding 读取弹幕
- `r2.comment.list`：列出 R2 弹幕

---

## 5. 并发与背压控制

### 5.1 消息处理限流

- **并发信号量**：`asyncio.Semaphore(100)`
- **用途**：防止突发消息击穿事件循环或数据库连接池

### 5.2 审计日志缓冲

- **缓冲上限**：5000 条
- **批量落库**：每批 200 条
- **落库间隔**：2 秒
- **采样策略**：成功的 `cache.get`、`log.report` 等高频消息按 1% 采样

### 5.3 配置下发防抖

- **防抖间隔**：5 秒（`_RESYNC_DEBOUNCE`）
- **冷却时间**：30 秒（`_RESYNC_COOLDOWN`）
- **用途**：合并多个 Worker 并发上报的封禁，避免配置下发风暴

---

## 6. 持久化

### 6.1 连接状态表：`control_nodes`

字段（待确认）：
- `node_id`：节点 ID
- `status`：连接状态
- `last_seen`：最后心跳时间
- `reconnect_count`：重连次数

### 6.2 消息审计表：`control_messages`

字段（待确认）：
- `message_id`：消息 ID
- `direction`：`worker_to_local` / `local_to_worker`
- `message_type`：消息类型
- `status`：`success` / `error` / `timeout`
- `payload`：消息体（JSON）
- `created_at`：创建时间

---

## 7. 诊断与可观测

### 7.1 运行时指标（`stats()` 方法）

```json
{
  "connected": true,
  "node_id": "节点 ID",
  "reconnect_count": 3,
  "pending_rpc": 5,
  "msg_received": 12345,
  "msg_handled": 12340,
  "msg_backlog": 5,
  "audit_buf_depth": 150,
  "audit_dropped": 0,
  "audit_sampled_out": 1000,
  "config_resync_pending": false,
  "config_resync_dirty": false
}
```

### 7.2 管理 API

- **节点列表**：`GET /api/v2/control/nodes`
- **消息审计**：`GET /api/v2/control/messages`
- **重连触发**：`POST /api/v2/control/reconnect`

---

## 8. Rust 迁移契约要点

### 8.1 必须保持的行为

1. **消息关联**：RPC 请求/响应通过 `id` 匹配
2. **超时处理**：本地发起 RPC 有超时，过期后清理 `_pending`
3. **幂等处理**：`cache.upsert`、`stats.report` 等需要去重
4. **心跳响应**：收到 `ping` 立即回 `pong`
5. **重连策略**：连接断开时退避重连，保留重连计数
6. **审计采样**：高频成功消息按 1% 采样，失败/超时全量记录
7. **配置下发防抖**：5 秒防抖 + 30 秒冷却
8. **并发限流**：消息处理并发上限 100
9. **审计缓冲**：批量落库，避免每条消息同步写 DB

### 8.2 字段大小写

- **消息类型**：小写 + 点分隔（`cache.get`、`stats.report`）
- **Payload 字段**：蛇形命名（`cache_key`、`worker_request_id`）
- **时间戳**：Unix 秒（浮点数或整数，待确认）

### 8.3 错误处理

- **未知消息类型**：记录日志但不中断连接
- **处理失败**：记录错误日志，不影响其他消息
- **连接失败**：记录错误并触发重连

---

## 9. 待补充信息

- [ ] 心跳间隔与超时阈值
- [ ] RPC 超时值
- [ ] `comment.archive` 和 `comment.get` 的 payload 结构
- [ ] `config.apply` 的完整字段
- [ ] `control_nodes` 和 `control_messages` 表结构
- [ ] 本地主动发起的 RPC 类型与参数
- [ ] 时间戳格式（整数或浮点数）
- [ ] NULL 值处理（`null` 或字段缺失）
- [ ] 消息大小上限与分片策略（如有）
