# 阶段 0：生产数据库现状与性能基线方案

> 状态：待执行 | 创建时间：2026-10-27

## 1. 数据库配置现状

### 1.1 数据库类型

根据 `src/config.py`：

- **默认类型**：SQLite（`DATABASE_TYPE: str = "sqlite"`）
- **生产路径**：`/app/config/database.db`（Docker 容器内）
- **备选方案**：MySQL、PostgreSQL（通过环境变量切换）

### 1.2 连接池配置

- **连接池大小**：40（`DB_POOL_SIZE`）
- **溢出上限**：40（`DB_MAX_OVERFLOW`）
- **线程池大小**：64（`DB_THREAD_POOL_SIZE`）
- **慢查询阈值**：200ms（`SLOW_SQL_MS`）

### 1.3 缓存策略

- **Redis**：启用（`REDIS_ENABLED: bool = True`）
- **Redis URL**：`redis://redis:6379/0`
- **响应体存储**：Redis 优先，不可用时降级为 SQL
- **缓存刷新间隔**：6 小时
- **过期数据最大保留**：30 天
- **负缓存 TTL**：6 小时（空结果累计 3 次后生效）

---

## 2. 核心表结构（ORM 模型）

### 2.1 `app_settings`（系统设置）

| 字段 | 类型 | 索引 | 说明 |
|---|---|---|---|
| id | Integer | PK | 自增主键 |
| key | String(100) | Unique | 配置键 |
| value | Text | - | 配置值 |
| value_type | String(30) | - | string/int/bool/json/secret |
| description | String(500) | - | 描述 |
| is_secret | Boolean | - | 是否敏感 |
| created_at | DateTime | - | 创建时间 |
| updated_at | DateTime | - | 更新时间 |

### 2.2 `control_nodes`（Worker 长连接节点）

| 字段 | 类型 | 索引 | 说明 |
|---|---|---|---|
| id | Integer | PK | 自增主键 |
| node_id | String(100) | Unique | 节点标识 |
| worker_id | String(100) | Index | Worker 实例 ID |
| worker_url | String(500) | - | Worker URL |
| connected | Boolean | - | 连接状态 |
| connection_id | String(100) | - | 连接标识 |
| protocol_version | String(50) | - | 协议版本（v1） |
| client_version | String(50) | - | 客户端版本 |
| last_connected_at | DateTime | - | 最后连接时间 |
| last_seen_at | DateTime | Index | 最后心跳时间 |
| latency_ms | Integer | - | 延迟（毫秒） |
| reconnect_count | Integer | - | 重连次数 |
| last_error | Text | - | 最后错误 |
| extra_json | JSON | - | 扩展信息 |
| created_at | DateTime | - | 创建时间 |
| updated_at | DateTime | - | 更新时间 |

### 2.3 `control_messages`（消息审计）

| 字段 | 类型 | 索引 | 说明 |
|---|---|---|---|
| id | BigInteger | PK | 自增主键 |
| message_id | String(100) | Unique | 消息 UUID |
| node_id | String(100) | Index | 节点标识 |
| direction | String(30) | Index | worker_to_local / local_to_worker |
| message_type | String(80) | Index | cache.get / cache.upsert 等 |
| status | String(30) | Index | pending / success / failed / timeout |
| request_cache_key | String(700) | Index | 缓存键（如适用） |
| payload_summary | Text | - | 载荷摘要（禁止存大响应体） |
| error_message | Text | - | 错误信息 |
| duration_ms | Integer | - | 处理耗时（毫秒） |
| created_at | DateTime | (created_at, id) | 创建时间（复合索引） |
| updated_at | DateTime | - | 更新时间 |

**复合索引**：`ix_cm_created_id (created_at, id)`（用于保留期清理）

### 2.4 `runtime_events`（运行事件）

| 字段 | 类型 | 索引 | 说明 |
|---|---|---|---|
| id | BigInteger | PK | 自增主键 |
| level | String(20) | Index | INFO / WARN / ERROR |
| category | String(80) | Index | control / cache / config / system |
| event | String(120) | Index | 事件类型 |
| message | Text | - | 消息内容 |
| details_json | JSON | - | 详细信息 |
| created_at | DateTime | Index | 创建时间 |

**注意**：无 `updated_at`（事件不可变）

### 2.5 其他核心表（待补充）

- `cache_*`（缓存相关表，位于 `models_v2/cache.py`）
- `users`、`api_tokens`（用户与认证，位于 `models_v2/users.py`）
- `monitoring_*`（监控指标，位于 `models_v2/monitoring.py`）

---

## 3. 生产环境数据盘点任务清单

### 3.1 数据库连接验证

- [ ] 确认生产环境使用的数据库类型（SQLite / MySQL / PostgreSQL）
- [ ] 验证数据库文件路径或连接字符串
- [ ] 检查数据库文件大小与磁盘剩余空间
- [ ] 测试数据库连接与权限

### 3.2 表结构与数据量

- [ ] 导出当前所有表的 schema（`CREATE TABLE` 语句）
- [ ] 统计每张表的行数
- [ ] 识别最大的表（按行数与磁盘占用）
- [ ] 检查索引完整性与碎片化程度

**SQLite 命令示例**：
```bash
sqlite3 /app/config/database.db ".schema" > schema_backup_$(date +%Y%m%d).sql
sqlite3 /app/config/database.db "SELECT name, COUNT(*) FROM sqlite_master WHERE type='table' GROUP BY name;"
```

**MySQL 命令示例**：
```sql
SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'danmu_data_center'
ORDER BY DATA_LENGTH DESC;
```

### 3.3 慢查询分析

- [ ] 启用慢查询日志（已有 `SLOW_SQL_MS: 200`）
- [ ] 查看 `/ext/diag/slow-sql` 接口（如已实现）
- [ ] 分析高频慢查询的 `EXPLAIN` 结果
- [ ] 识别缺失的索引或全表扫描

### 3.4 Redis 状态

- [ ] 验证 Redis 连接与版本
- [ ] 检查 Redis 内存使用与碎片率
- [ ] 统计 `dd_danmaku:*` 键数量与大小分布
- [ ] 确认持久化策略（RDB / AOF）

**Redis 命令示例**：
```bash
redis-cli INFO memory
redis-cli INFO keyspace
redis-cli --scan --pattern 'dd_danmaku:*' | head -100
redis-cli MEMORY USAGE dd_danmaku:some_key
```

### 3.5 备份验证

- [ ] 确认现有备份方案（自动备份 / 手动备份）
- [ ] 验证最近一次备份的完整性
- [ ] 测试从备份恢复的流程
- [ ] 记录备份文件位置与大小

---

## 4. 性能基线采集方案

### 4.1 CPU 与内存

**工具**：`docker stats` 或 `top` / `htop`

**采集指标**：
- CPU 使用率（平均值、峰值）
- 内存使用量（RSS、VSZ）
- 线程数

**采集方式**：
```bash
# 实时监控（5 分钟）
docker stats data-center --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}" > baseline_cpu_mem.txt

# 或在容器内使用 psutil（Python）
```

### 4.2 SQL 查询性能

**工具**：慢查询日志 + `EXPLAIN`

**采集指标**：
- 查询频率 TOP 10
- 平均/最大执行时间
- 锁等待时间
- 全表扫描次数

**采集方式**：
- 通过 `/ext/diag/slow-sql` 接口（如有）
- 或查询 SQLite/MySQL 慢查询日志

### 4.3 Redis 性能

**工具**：`redis-cli --latency` / `redis-cli --stat`

**采集指标**：
- 平均延迟
- 命中率
- 键过期速率
- 内存碎片率

**采集方式**：
```bash
redis-cli --latency-history
redis-cli INFO stats | grep -E 'keyspace_hits|keyspace_misses'
```

### 4.4 消息队列/Worker 通信

**采集指标**：
- 消息接收速率（`msg_received` 增长率）
- 消息处理延迟（`msg_backlog`）
- 审计缓冲水位（`audit_buf_depth`）
- 配置下发频率

**采集方式**：
```bash
curl -H "X-Control-Token: $TOKEN" http://localhost:7759/api/v2/ext/diag
```

### 4.5 API 响应时间

**工具**：前端性能监控或 `curl` + 时间戳

**采集指标**：
- P50、P95、P99 响应时间
- 超时率
- 错误率（4xx / 5xx）

**采集方式**：
```bash
# 单次测试
time curl -H "Authorization: Bearer $TOKEN" http://localhost:7759/api/v2/dashboard/summary

# 或使用 Apache Bench
ab -n 100 -c 10 -H "Authorization: Bearer $TOKEN" http://localhost:7759/api/v2/dashboard/summary
```

---

## 5. 固定负载压测方案

### 5.1 压测目标

验证当前系统在典型负载下的性能表现，为 Rust 重构提供对比基准。

### 5.2 测试场景

#### 场景 1：管理 UI 常规操作

- **端点**：`/api/v2/dashboard/summary`、`/api/v2/cache/stats`
- **并发**：10 用户
- **持续时间**：5 分钟
- **预期 TPS**：待测量

#### 场景 2：Worker 缓存查询高峰

- **端点**：模拟 Worker 发送 `cache.get` 消息
- **并发**：50 消息/秒
- **持续时间**：10 分钟
- **预期延迟**：< 50ms（P95）

#### 场景 3：弹幕搜索（dandanplay API）

- **端点**：`/api/v2/search?anime=关键词`
- **并发**：20 请求/秒
- **持续时间**：5 分钟
- **预期响应时间**：< 200ms（P95）

### 5.3 工具选择

- **HTTP 压测**：Apache Bench、wrk、Locust
- **WebSocket 压测**：自定义脚本（模拟 Worker 消息）
- **监控**：同时采集 CPU、内存、SQL、Redis 指标

---

## 6. 基线数据记录模板

### 6.1 系统资源

| 指标 | 空闲值 | 低负载 | 高负载 | 峰值 |
|---|---|---|---|---|
| CPU 使用率 | - | - | - | - |
| 内存使用 (MB) | - | - | - | - |
| 线程数 | - | - | - | - |
| 磁盘 I/O (MB/s) | - | - | - | - |

### 6.2 数据库性能

| 指标 | 平均值 | P95 | P99 | 最大值 |
|---|---|---|---|---|
| SQL 查询耗时 (ms) | - | - | - | - |
| 连接池等待时间 (ms) | - | - | - | - |
| 慢查询频率 (/min) | - | - | - | - |

### 6.3 Redis 性能

| 指标 | 值 |
|---|---|
| 平均延迟 (ms) | - |
| 命中率 (%) | - |
| 内存使用 (MB) | - |
| 键数量 | - |

### 6.4 API 响应时间

| 端点 | P50 (ms) | P95 (ms) | P99 (ms) | 错误率 (%) |
|---|---|---|---|---|
| `/api/v2/dashboard/summary` | - | - | - | - |
| `/api/v2/cache/stats` | - | - | - | - |
| `/api/v2/search` | - | - | - | - |

---

## 7. 备份与回滚方案

### 7.1 备份检查清单

- [ ] 数据库完整备份（包含所有表）
- [ ] Redis RDB/AOF 快照
- [ ] 配置文件备份（`.env`、`docker-compose.yml`）
- [ ] 代码版本标记（git commit hash）

### 7.2 恢复演练

**SQLite 恢复**：
```bash
cp /app/config/database.db /app/config/database.db.backup
sqlite3 /app/config/database.db < schema_backup.sql
```

**MySQL 恢复**：
```bash
mysqldump -u root -p danmu_data_center > backup_$(date +%Y%m%d).sql
mysql -u root -p danmu_data_center < backup_$(date +%Y%m%d).sql
```

**Redis 恢复**：
```bash
redis-cli BGSAVE
cp /var/lib/redis/dump.rdb /backup/dump_$(date +%Y%m%d).rdb
```

### 7.3 灰度切换回滚计划

1. **数据库快照**：重构前创建只读副本
2. **双写验证**：Rust 写入后比对 Python 结果
3. **流量切换**：逐步将流量从 Python 切到 Rust
4. **回滚触发条件**：
   - 错误率 > 1%
   - P95 响应时间 > 基线 2 倍
   - 数据一致性校验失败

---

## 8. 下一步行动

- [ ] 提供生产环境访问方式（SSH / Docker exec）
- [ ] 执行 §3 数据盘点任务
- [ ] 执行 §4 基线采集
- [ ] 执行 §5 固定负载压测
- [ ] 填写 §6 基线数据记录表
- [ ] 验证 §7 备份与恢复流程
