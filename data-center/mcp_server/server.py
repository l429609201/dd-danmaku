"""
dd-danmaku 外部控制 MCP Server

用 stdio 暴露本地端「外部控制 API」(/api/v2/ext/*) 为 MCP 工具，
供 AI 客户端实时接入本地端拉取运行时诊断指标、定位高并发瓶颈。

鉴权：统一用「外部控制独立密钥」，通过环境变量传入：
  - DDC_BASE_URL     本地端基址，如 http://192.168.10.220:7759
  - DDC_EXT_TOKEN    外部控制独立密钥（X-External-Token）

运行：
  uv run --with "mcp[cli]" --with httpx python server.py
或在 MCP 客户端配置中以 stdio 方式启动本文件。
"""
import os
import httpx

from mcp.server.fastmcp import FastMCP

BASE_URL = os.environ.get("DDC_BASE_URL", "http://127.0.0.1:7759").rstrip("/")
EXT_TOKEN = os.environ.get("DDC_EXT_TOKEN", "")
TIMEOUT = float(os.environ.get("DDC_TIMEOUT", "10"))

mcp = FastMCP("dd-danmaku-control")


async def _get(path: str) -> dict:
    """带外部控制密钥调用本地端 ext API，返回 JSON（异常包装为 error 字段）"""
    url = f"{BASE_URL}/api/v2/ext{path}"
    headers = {"X-External-Token": EXT_TOKEN}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code == 401:
                return {"error": "鉴权失败：DDC_EXT_TOKEN 无效或未配置"}
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        return {"error": f"请求失败: {e}", "url": url}


@mcp.tool()
async def diag_snapshot() -> dict:
    """一次性抓取本地端全部诊断指标（系统资源/事件循环/队列/连接池/长连接）。
    定位高并发瓶颈的首选：一次看全运行健康度。"""
    return await _get("/diag/snapshot")


@mcp.tool()
async def diag_system() -> dict:
    """系统资源：CPU%/内存/负载(load1/5/15)/线程数/打开FD数/事件循环延迟。"""
    return await _get("/diag/system")


@mcp.tool()
async def diag_eventloop() -> dict:
    """事件循环延迟(loop_lag_ms)与运行中任务数。lag 高=存在同步阻塞。"""
    return await _get("/diag/eventloop")


@mcp.tool()
async def diag_queues() -> dict:
    """削峰队列健康度：实体解析队列 + 访问日志缓冲的深度/丢弃/落库计数。
    depth 持续走高或 dropped 增长=削峰失效，写入跟不上。"""
    return await _get("/diag/queues")


@mcp.tool()
async def diag_db_pool() -> dict:
    """SQLAlchemy 连接池水位(size/checkedin/checkedout/overflow)。
    checkedout 接近 size+overflow=连接池将耗尽，DB 成瓶颈。"""
    return await _get("/diag/db-pool")


@mcp.tool()
async def diag_control() -> dict:
    """control_client 长连接健康度：连接状态/pending RPC 数/消息处理速率与积压。"""
    return await _get("/diag/control")


if __name__ == "__main__":
    mcp.run()
