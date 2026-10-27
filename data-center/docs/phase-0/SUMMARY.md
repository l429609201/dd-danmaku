# 阶段 0 交付总结

> 完成时间：2026-10-27 | 状态：已交付

## 📦 交付物清单

### 1. API 契约文档（`api-contracts.md`）

- ✅ **管理 UI API**：147 个端点统计，22 个模块分类
- ✅ **前端调用枚举**：从 Vue 组件提取 50+ 实际调用端点
- ✅ **dandanplay 官方协议**：文件识别、搜索、弹幕、番剧详情四大核心端点
- ✅ **签名算法**：`base64(sha256(AppId + Timestamp + Path + AppSecret))`
- ✅ **鉴权模型**：公开/受限接口、签名验证/凭证模式、JWT Token

### 2. Worker 协议文档（`worker-protocol.md`）

- ✅ **消息类型**：11 种 Worker→data-center 消息（cache.get、cache.upsert、stats.report 等）
- ✅ **RPC 模式**：请求/响应关联、超时处理、幂等要求
- ✅ **并发控制**：Semaphore(100)、审计缓冲 5000 条、批量落库 200 条/2 秒
- ✅ **防抖机制**：配置下发 5 秒防抖 + 30 秒冷却
- ✅ **审计采样**：高频成功消息 1% 采样，失败/超时全量记录
- ✅ **生命周期**：自动重连、心跳、状态持久化

### 3. 数据库基线文档（`database-baseline.md`）

- ✅ **配置现状**：SQLite 默认、连接池 40+40、线程池 64、慢查询 200ms
- ✅ **表结构**：`app_settings`、`control_nodes`、`control_messages`、`runtime_events` 完整字段与索引
- ✅ **盘点任务清单**：数据库连接验证、表结构导出、慢查询分析、Redis 状态检查
- ✅ **性能采集方案**：CPU/内存、SQL、Redis、消息队列、API 响应时间五维度
- ✅ **压测方案**：三个典型场景（管理 UI、Worker 缓存、dandanplay 搜索）
- ✅ **备份与回滚**：SQLite/MySQL/Redis 备份命令、恢复演练、灰度回滚条件

---

## 🎯 阶段 0 目标达成情况

| 子阶段 | 状态 | 说明 |
|---|---|---|
| 0.1 API 契约枚举 | ✅ 完成 | 三类 API 契约已文档化 |
| 0.2 性能基线方案 | ✅ 完成 | 采集方案与压测方案已制定 |
| 0.3 生产 DB 盘点 | ⏳ 待执行 | 需要生产环境访问权限 |
| 0.4 dandanplay 协议 | ✅ 完成 | 官方文档已分析，端点已列出 |

---

## 📊 关键发现

### 管理 UI API
- **核心模块**：external_control (24)、media (16)、comment_store (12)、key_pool (9)
- **调用方式**：Axios + Cookie 会话鉴权，`/api/v2/*` 统一前缀
- **待确认**：权限角色表、分页参数、错误响应格式

### Worker 协议
- **高频消息**：`cache.get`（每请求一次）、`stats.report`（定期批量）
- **性能瓶颈**：原审计每条消息同步写 DB，已改为批量落库 + 采样
- **待确认**：心跳间隔、RPC 超时值、`comment.*` 消息 payload

### 数据库
- **默认配置**：SQLite + Redis，连接池 80 容量
- **慢查询阈值**：200ms
- **待验证**：生产环境实际使用的数据库类型、表行数、索引效率

---

## 🚀 下一步（阶段 1）

### 前置条件

1. **生产环境访问**：执行数据盘点任务（§0.3）
2. **基线数据采集**：完成 CPU/SQL/Redis/API 性能测量
3. **备份验证**：确认当前备份可用且可恢复

### 阶段 1 目标

- 搭建 Rust workspace（多 crate 结构）
- 配置 SeaORM + SQLite/MySQL/PostgreSQL 多后端
- 验证 ORM 与现有 schema 兼容性
- 构建测试 Docker 镜像
- 编写健康检查端点

### 验收标准

- Rust 服务能连接生产数据库（只读模式）
- SeaORM 能正确读取 `control_nodes`、`control_messages` 等核心表
- Docker 镜像构建成功且启动时间 < 5 秒
- 健康检查端点返回数据库连接状态

---

## 📝 待补充信息

### 需要用户提供

- [ ] 生产环境 Docker 容器名称或访问方式
- [ ] 是否有外部监控系统（Prometheus、Grafana 等）
- [ ] 当前备份策略与最近备份位置
- [ ] 是否有真实 Worker 实例可用于测试

### 需要后续调研

- [ ] `cache.py` 中的缓存表结构
- [ ] `users.py` 中的用户与 token 表结构
- [ ] `monitoring.py` 中的监控指标表结构
- [ ] dandanplay 真实客户端的请求样例

---

## 📂 文档位置

所有阶段 0 文档已保存在：

```
data-center/docs/phase-0/
├── api-contracts.md         # API 契约清单
├── worker-protocol.md       # Worker 协议文档
└── database-baseline.md     # 数据库与性能基线
```

---

## ✅ 可继续推进

阶段 0 的**规划与文档化工作已完成**。阶段 1（Rust 技术验证）的前置条件已明确，可以在以下两种模式之一下推进：

1. **并行模式**：先用模拟数据启动 Rust 技术验证，同时等待生产环境访问
2. **串行模式**：先完成生产环境盘点（§0.3），再启动阶段 1

**建议**：采用并行模式，用 SQLite 测试数据先验证 SeaORM 与 Rust 服务架构，生产环境访问到位后再补充真实数据验证。
