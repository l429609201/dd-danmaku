# dd-danmaku 外部控制 MCP Server

把本地端「外部控制 API」(`/api/v2/ext/*`) 封装为 MCP 工具，供 AI 客户端实时接入本地端拉取运行时诊断指标、定位高并发瓶颈。

## 提供的工具

| 工具 | 说明 |
|------|------|
| `diag_snapshot` | 一次性抓全部诊断指标（首选） |
| `diag_system` | CPU/内存/负载/线程/FD/事件循环延迟 |
| `diag_eventloop` | 事件循环延迟 + 运行任务数（判断同步阻塞） |
| `diag_queues` | 削峰队列深度/丢弃/落库计数 |
| `diag_db_pool` | 连接池水位（判断 DB 瓶颈） |
| `diag_control` | 长连接健康度/pending RPC/消息积压 |

## 鉴权

统一使用「外部控制独立密钥」，通过环境变量传入：

- `DDC_BASE_URL`：本地端基址，如 `http://192.168.10.220:7759`
- `DDC_EXT_TOKEN`：外部控制独立密钥（对应本地端 `X-External-Token`）

密钥来源：本地端管理后台 `external_control_token`（AppSetting），或环境变量 `EXTERNAL_CONTROL_TOKEN`。首次启动本地端若都未配置，会自动生成一个并打印在日志里（搜索「外部控制 API 密钥」）。

## 依赖

```
mcp[cli]>=1.0
httpx>=0.25
```

## 运行

```bash
DDC_BASE_URL=http://192.168.10.220:7759 \
DDC_EXT_TOKEN=你的外部控制密钥 \
uv run --with "mcp[cli]" --with httpx python server.py
```

## MCP 客户端配置示例（stdio）

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
