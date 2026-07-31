# dd-danmaku 外部控制 MCP Server

把本地端「外部控制 API」(`/api/v2/ext/*`) 封装为 MCP 工具，供 AI 客户端实时接入本地端拉取运行时诊断指标、定位性能瓶颈。

## 两种接入方式

| 方式 | 端点 / 命令 | 适用场景 |
|------|------------|---------|
| **HTTP（推荐）** | `POST {本地端}/api/v2/ext/mcp` | 无需本地装 Python 依赖，直连即用 |
| stdio | `python mcp_server/server.py` | 本机有源码与 `uv`，适合开发调试 |

两种方式暴露的工具完全一致。**最简单的做法：打开管理后台「系统设置」页 →「MCP 接入配置」面板 → 选 HTTP → 复制 JSON 粘贴到客户端配置。**

### HTTP 方式配置

```json
{
  "mcpServers": {
    "dd-danmaku-control": {
      "type": "http",
      "url": "http://192.168.10.220:7759/api/v2/ext/mcp",
      "headers": { "Authorization": "Bearer 你的外部控制密钥" }
    }
  }
}
```

鉴权头两种都支持：`Authorization: Bearer <token>` 或 `X-External-Token: <token>`。

> HTTP 端点是手写的 JSON-RPC 2.0 实现（`src/api/v2/endpoints/mcp_http.py`），
> 不依赖 mcp SDK——因为项目锁定 `fastapi==0.104.1` + `pydantic==2.5.0`，
> 而 mcp SDK 要求 `pydantic>=2.7`，引入会强制升级核心依赖。
> 支持 `initialize` / `tools/list` / `tools/call` / `ping`，不支持 SSE 推送（诊断工具都是请求-响应式，不需要）。

## 架构：MCP 只是外部控制 API 的包装层

```
AI 客户端
   │  MCP JSON-RPC
   ▼
MCP 适配层（两种传输，工具集完全一致）
   ├─ HTTP:  src/api/v2/endpoints/mcp_http.py
   │           · 实现 → 直接调用下方端点函数
   │           · 说明 → 反射 docstring
   │           · schema → 反射函数签名
   └─ stdio: mcp_server/server.py
               · 启动时向 HTTP 端拉 tools/list 动态注册，本地零硬编码
   │
   ▼
外部控制 API  src/api/v2/endpoints/external_control.py
               ← 业务逻辑与工具说明的唯一来源
   │
   ▼
各诊断服务（system_stats / slow_sql / control_client / 队列 / 连接池）
```

适配层不含任何诊断逻辑、也不重复任何说明文字。**新增一个 ext 诊断接口后，
只需在 `mcp_http.py` 的 `_TOOL_HANDLERS` 里加一行映射**——工具说明与入参
schema 会自动从该函数的 docstring 和签名生成，stdio 端也会自动同步。

> 因此给 AI 看的工具说明，请直接写在 ext 端点函数的 docstring 里。
> 首行是简述，空行后是"这个指标怎么读、什么情况算异常"；
> `参数：` 段落会被自动剔除（入参已由 schema 表达）。

## 提供的工具

工具名与对应接口的映射见 `mcp_http.py` 的 `_TOOL_HANDLERS`；
每个工具的说明以 `external_control.py` 中对应函数的 docstring 为准
（避免此处再抄一份导致不一致）。当前包含：

| 工具 | 对应 ext 接口 |
|------|--------------|
| `diag_snapshot` | `GET /diag/snapshot` |
| `diag_system` | `GET /diag/system` |
| `diag_eventloop` | `GET /diag/eventloop` |
| `diag_queues` | `GET /diag/queues` |
| `diag_db_pool` | `GET /diag/db-pool` |
| `diag_control` | `GET /diag/control` |
| `diag_slow_sql` | `GET /diag/slow-sql` |
| `diag_slow_sql_reset` | `POST /diag/slow-sql/reset` |

想看实时的完整说明，直接请求 `tools/list`：

```bash
curl -s -X POST http://本地端:7759/api/v2/ext/mcp \
  -H "Authorization: Bearer 你的密钥" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## 定位"某个页面慢"的推荐流程

1. `diag_slow_sql_reset` 清空历史统计
2. 让用户在浏览器打开那个慢页面
3. `diag_slow_sql` 查看这次实际产生的慢查询，按 `total_ms` 排序找元凶
4. 若慢查询不明显，用 `diag_eventloop` 看 `loop_lag_ms`（高 = 有同步阻塞）
   和 `diag_db_pool` 看 `checkedout` 是否接近 `size + overflow`（连接池耗尽）

## 鉴权

两种方式共用「外部控制独立密钥」，与登录账号无关，可随时轮换。

- HTTP 方式：请求头 `Authorization: Bearer <token>` 或 `X-External-Token: <token>`
- stdio 方式：环境变量 `DDC_BASE_URL`（本地端基址）+ `DDC_EXT_TOKEN`（密钥）

获取密钥（任一）：
- 管理后台「系统设置」→「外部控制密钥」→ 查看密钥 / 重新生成
- 环境变量 `EXTERNAL_CONTROL_TOKEN`
- 首次启动若都未配置，会自动生成并打印在日志里（搜索「外部控制 API 密钥」）

## stdio 方式（仅客户端不支持 HTTP 传输时才需要）

依赖（只有 stdio 方式需要，**不在** data-center 主依赖里）：

```
mcp[cli]>=1.0
httpx>=0.25
```

> stdio 版是 HTTP 端的透明代理：启动时向 `/api/v2/ext/mcp` 请求 `tools/list`
> 动态注册工具，因此**本地端必须先启动且可达**，否则 stdio server 会启动失败
> 并在 stderr 打印原因。好处是工具清单与说明永远与本地端一致，无需同步维护。

运行：

```bash
DDC_BASE_URL=http://192.168.10.220:7759 \
DDC_EXT_TOKEN=你的外部控制密钥 \
uv run --with "mcp[cli]" --with httpx python server.py
```

客户端配置示例：

```json
{
  "mcpServers": {
    "dd-danmaku-control": {
      "command": "uv",
      "args": ["run", "--with", "mcp[cli]", "--with", "httpx",
               "python", "/绝对路径/data-center/mcp_server/server.py"],
      "env": {
        "DDC_BASE_URL": "http://192.168.10.220:7759",
        "DDC_EXT_TOKEN": "你的外部控制密钥"
      }
    }
  }
}
```
