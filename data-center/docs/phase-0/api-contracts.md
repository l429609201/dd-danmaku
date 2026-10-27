# 阶段 0：API 契约清单与调用方分析

> 状态：进行中 | 创建时间：2026-10-27 | 最后更新：2026-10-27

## 1. 管理 UI API（`/api/v2/*`）

### 1.1 端点统计

从源码 `src/api/v2/api.py` 和 `endpoints/` 目录分析得出：

| 模块 | 路由数 | 前缀 | 主要功能 |
|---|---|---|---|
| external_control.py | 24 | `/ext` | 外部控制、Worker 诊断 |
| media.py | 16 | `/media` | 媒体库管理 |
| comment_store.py | 12 | `/comment-store` | 弹幕存储 |
| key_pool.py | 9 | `/key-pool` | 密钥池管理 |
| users.py | 7 | `/users` | 用户管理 |
| ua_rules.py | 7 | `/ua-rules` | UA 限流规则 |
| oauth_config.py | 7 | `/oauth-config` | OAuth 配置 |
| dashboard.py | 7 | `/dashboard` | 概览仪表盘 |
| cleanup.py | 7 | `/cleanup` | 数据清理 |
| cache.py | 7 | `/cache` | 响应缓存 |
| sign_key_pool.py | 6 | `/sign-key-pool` | 签名密钥池 |
| user_allow_pool.py | 5 | `/user-allow-pool` | 用户允许名单 |
| ip_rules.py | 5 | `/ip-rules` | IP 黑白名单 |
| episodes.py | 5 | `/episodes` | 集数链接 |
| auth.py | 5 | `/auth` | 认证 |
| worker_logs.py | 4 | `/worker-logs` | Worker 日志 |
| control.py | 4 | `/control` | Worker 控制 |
| entities.py | 3 | `/entities` | 实体索引 |
| settings.py | 2 | `/settings` | 系统设置 |
| mcp_http.py | 2 | `/ext` | MCP 扩展 |
| ip_stats.py | 2 | `/ip-stats` | IP 统计 |
| runtime_events.py | 1 | `/runtime-events` | 运行日志 |
| **总计** | **147** | - | - |

### 1.2 前端调用源

- **位置**：`web/src/utils/api.js`
- **调用方式**：Axios + Cookie 会话鉴权
- **状态**：待枚举实际调用的端点与参数结构

### 1.3 鉴权模型

- **类型**：HttpOnly Cookie + JWT
- **权限角色**：管理员、操作员、只读（待确认具体权限表）
- **状态码**：401（未认证）、403（无权限）

### 1.4 待办事项

- [ ] 枚举前端实际调用的 147 个端点中的核心子集
- [ ] 记录每个端点的请求/响应 schema、分页、过滤参数
- [ ] 确认哪些端点是只读、哪些是写操作、哪些是危险操作
- [ ] 提取分页、错误响应、权限检查的共享契约

---

## 2. Worker 通信协议

### 2.1 当前实现

- **连接方向**：data-center → 远端 Cloudflare Worker（主动 WebSocket 连接）
- **协议文件**：`src/services_v2/control_client.py`
- **消息类型**：RPC、缓存读写、配置下发、日志上报、心跳
- **鉴权**：`CONTROL_TOKEN` + `node_id`
- **管理入口**：`/api/v2/control/*`（4 个端点）和 `/api/v2/ext/*`（24 个端点）

### 2.2 消息契约要点

- **序列化**：JSON（待确认字段大小写、null 处理）
- **RPC correlation**：待确认请求/响应关联机制
- **重连策略**：待确认退避、超时与去重逻辑
- **审计**：待确认消息存储位置与格式

### 2.3 待办事项

- [ ] 提取 WebSocket 消息类型枚举与 schema
- [ ] 记录心跳间隔、超时阈值、重连参数
- [ ] 确认 Worker 日志聚合流程与 SSE 订阅实现
- [ ] 明确哪些消息需要幂等处理

---

## 3. dandanplay 兼容 API

### 3.1 官方参考协议

根据 [弹弹play开放弹幕网络文档](https://doc.dandanplay.com/open/)，关键端点包括：

#### 3.1.1 文件识别与搜索

| 端点 | 方法 | 功能 | 参数 |
|---|---|---|---|
| `/api/v2/match` | POST | 文件识别（hash/文件名/大小/长度） | `fileName`, `fileHash`(MD5), `fileSize`, `videoDuration` |
| `/api/v2/search` | GET | 番剧/节目搜索 | `anime`（关键词） |

**Hash 计算**：文件前 16MB（16×1024×1024 字节）的 MD5

#### 3.1.2 弹幕相关

| 端点 | 方法 | 功能 | 参数 |
|---|---|---|---|
| `/api/v2/comment/{episodeId}` | GET | 获取弹幕 | `withRelated=true`（整合第三方） |
| `/api/v2/comment/{episodeId}/app` | POST | 发送弹幕 | 弹幕内容、时间、模式等 |

#### 3.1.3 番剧信息

| 端点 | 方法 | 功能 | 返回 |
|---|---|---|---|
| `/api/v2/bangumi/{animeId}` | GET | 番剧详情 | 标题、简介、封面、集数列表 |

### 3.2 鉴权模型

- **公开接口**：文件识别、搜索、获取弹幕（不需要用户登录）
- **受限接口**：发送弹幕、关注、播放历史（需要 JWT Token，放在 `Authorization` 头）
- **签名验证模式**：
  - 请求头：`X-AppId`、`X-Timestamp`、`X-Signature`
  - 算法：`base64(sha256(AppId + Timestamp + Path + AppSecret))`
- **凭证模式**：`X-AppId` + `X-AppSecret`

### 3.3 响应格式

```json
{
  "success": true/false,
  "errorCode": 0,  // 非零表示错误
  "errorMessage": "错误描述",
  "data": { ... }
}
```

### 3.4 待实施范围

本项目 dandanplay 兼容 API 初期实施范围：

#### 第一阶段（核心）
- [x] 文件识别：`POST /api/v2/match`
- [x] 搜索：`GET /api/v2/search`
- [x] 获取弹幕：`GET /api/v2/comment/{episodeId}`
- [x] 番剧详情：`GET /api/v2/bangumi/{animeId}`

#### 第二阶段（可选）
- [ ] 发送弹幕：`POST /api/v2/comment/{episodeId}/app`
- [ ] 用户登录：待确认是否实施

### 3.5 与管理 API 的隔离

- **不共享**管理端 JWT 与 Cookie 鉴权
- **独立**的签名验证中间件与 AppId/AppSecret 管理
- **独立**的限流、日志脱敏与错误码映射
- **共享**底层匹配、缓存、实体查询、Worker 调用用例

### 3.6 待办事项

- [ ] 确认目标客户端具体需要哪些端点
- [ ] 获取真实客户端的请求样例（包括 header、query、body）
- [ ] 明确 `episodeId` 格式、`animeId` 与内部 ID 的映射关系
- [ ] 确认异步任务状态查询的实现方式（如果协议支持）
- [ ] 设计 AppId/AppSecret 存储与轮换机制

---

## 4. 契约测试策略

### 4.1 管理 UI API

- **工具**：pytest + FastAPI TestClient
- **范围**：每个端点的核心 happy path、权限检查、分页边界
- **验收**：Rust 实现的响应字段与 Python 基线一致

### 4.2 Worker 协议

- **工具**：模拟 WebSocket 服务端 + 客户端重放真实消息
- **范围**：连接、心跳、RPC、断线重连、超时、去重
- **验收**：Rust 客户端与 Python 客户端行为等价

### 4.3 dandanplay 兼容 API

- **工具**：固定样例 + 真实客户端端到端测试
- **范围**：文件识别、搜索、获取弹幕、番剧详情
- **验收**：与官方或参考实现的字段、状态码、错误格式对齐

---

## 5. 下一步

1. **枚举前端实际调用**：分析 `web/src/utils/api.js` 与各 Vue 页面，提取核心端点清单
2. **Worker 消息类型**：提取 `control_client.py` 的消息 schema 与状态机
3. **dandanplay 样例**：获取真实客户端的请求/响应样例或使用官方 Swagger
4. **生产 DB 盘点**：确认真实环境的 schema、索引、行数与备份情况
5. **性能基线方案**：设计 CPU/SQL/Redis/队列的采集与固定负载压测方案
