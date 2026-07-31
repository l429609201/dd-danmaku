"""
dd-danmaku 外部控制 MCP Server（stdio 传输）

定位：**stdio → HTTP 的透明代理**。本文件不硬编码任何工具清单或说明——
启动时向本地端的 HTTP 版 MCP 端点（/api/v2/ext/mcp）请求 `tools/list`，
把拿到的工具动态注册为本地 stdio 工具；调用时转发 `tools/call`。

这样说明文字只在一处维护：外部控制端点函数的 docstring
（src/api/v2/endpoints/external_control.py）。链路：

    docstring → mcp_http.py 反射生成 → tools/list → 本文件动态注册

新增 ext 诊断接口时，本文件无需任何改动。

何时用 stdio 而非 HTTP：
HTTP 方式（客户端直连 /api/v2/ext/mcp）无需本机 Python 依赖，是推荐做法。
仅当客户端不支持 HTTP 传输、只认 stdio 时才需要本文件。

鉴权：环境变量
  - DDC_BASE_URL   本地端基址，如 http://192.168.10.220:7759
  - DDC_EXT_TOKEN  外部控制独立密钥

运行：
  uv run --with "mcp[cli]" --with httpx python server.py
"""
import asyncio
import json
import os
import sys
from typing import Any, Dict

import httpx

from mcp.server.fastmcp import FastMCP

BASE_URL = os.environ.get("DDC_BASE_URL", "http://127.0.0.1:7759").rstrip("/")
EXT_TOKEN = os.environ.get("DDC_EXT_TOKEN", "")
TIMEOUT = float(os.environ.get("DDC_TIMEOUT", "15"))

MCP_ENDPOINT = f"{BASE_URL}/api/v2/ext/mcp"
_HEADERS = {
    "Authorization": f"Bearer {EXT_TOKEN}",
    "X-External-Token": EXT_TOKEN,
    "Content-Type": "application/json",
}

mcp = FastMCP("dd-danmaku-control")


async def _rpc(method: str, params: Dict[str, Any] | None = None) -> dict:
    """向本地端 HTTP MCP 端点发一次 JSON-RPC 调用"""
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(MCP_ENDPOINT, headers=_HEADERS, json=payload)
        if resp.status_code == 401:
            raise RuntimeError("鉴权失败：DDC_EXT_TOKEN 无效或未配置")
        resp.raise_for_status()
        return resp.json()


async def _fetch_tools() -> list:
    """拉取远端工具清单（含说明与 inputSchema），失败抛异常由启动流程处理"""
    data = await _rpc("tools/list")
    if "error" in data:
        raise RuntimeError(f"tools/list 失败: {data['error']}")
    return data.get("result", {}).get("tools", [])


def _register(tool: dict) -> None:
    """把一个远端工具注册为本地 stdio 工具

    参数按远端 inputSchema 里声明的名字透传，说明直接用远端的 description，
    本地不做任何加工，保证与 ext 端点 docstring 一致。
    """
    name = tool["name"]
    description = tool.get("description") or name
    schema = tool.get("inputSchema") or {}
    props = list((schema.get("properties") or {}).keys())

    async def _proxy(**kwargs) -> str:
        """转发 tools/call 到本地端，返回其文本内容"""
        args = {k: v for k, v in kwargs.items() if v is not None}
        try:
            data = await _rpc("tools/call", {"name": name, "arguments": args})
        except Exception as e:
            return json.dumps({"error": f"请求失败: {e}", "endpoint": MCP_ENDPOINT},
                              ensure_ascii=False)
        if "error" in data:
            return json.dumps({"error": data["error"]}, ensure_ascii=False)
        content = data.get("result", {}).get("content") or []
        if content and isinstance(content[0], dict):
            return content[0].get("text", "")
        return json.dumps(data.get("result", {}), ensure_ascii=False)

    # FastMCP 从函数签名推断入参与出参 schema，故按远端 schema 动态生成同名
    # 关键字参数。两个分支都必须显式标注 `-> str`：缺标注时 FastMCP 按 Any
    # 处理返回值，会对已是字符串的结果再做一次包装，客户端读到空响应。
    if props:
        sig_args = ", ".join(f"{p}=None" for p in props)
        call_args = ", ".join(f"{p}={p}" for p in props)
        ns: Dict[str, Any] = {"_proxy": _proxy}
        exec(  # noqa: S102 - 仅用远端 schema 里的合法标识符构造签名，无外部输入
            f"async def _tool({sig_args}) -> str:\n"
            f"    return await _proxy({call_args})",
            ns,
        )
        fn = ns["_tool"]
    else:
        async def fn() -> str:  # type: ignore[misc]
            return await _proxy()

    fn.__name__ = name
    fn.__doc__ = description
    mcp.tool(name=name, description=description)(fn)


async def _bootstrap() -> None:
    """启动时同步远端工具清单"""
    tools = await _fetch_tools()
    for t in tools:
        _register(t)
    print(f"已从 {MCP_ENDPOINT} 同步 {len(tools)} 个工具: "
          f"{', '.join(t['name'] for t in tools)}", file=sys.stderr)


if __name__ == "__main__":
    try:
        asyncio.run(_bootstrap())
    except Exception as e:
        print(f"启动失败：无法从本地端同步工具清单 - {e}\n"
              f"请确认 DDC_BASE_URL({BASE_URL}) 可达、DDC_EXT_TOKEN 正确，"
              f"且本地端已启动。", file=sys.stderr)
        sys.exit(1)
    mcp.run()