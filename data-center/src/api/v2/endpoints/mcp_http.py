"""
MCP over HTTP 端点（Streamable HTTP 传输）

定位：**纯协议适配层**。只做「MCP JSON-RPC ⇄ 外部控制 API」的格式转换，
不含任何诊断业务逻辑，也不重复写任何说明文字：

- 工具实现 → 直接调用 `external_control.py` 的端点函数
- 工具说明 → 从端点函数的 docstring 反射提取
- 入参 schema → 从端点函数签名（类型注解 + 默认值）反射生成

因此 ext 端点是业务与文档的唯一来源。新增诊断接口时，只需在
`_TOOL_HANDLERS` 里加一行映射，说明和 schema 自动跟上。

为什么手写而不用 mcp SDK：
项目锁定 fastapi==0.104.1 + pydantic==2.5.0，而 mcp SDK 要求 pydantic>=2.7，
引入会强制升级核心依赖、波及全部现有接口。MCP 的 Streamable HTTP 传输本质就是
「POST JSON-RPC 2.0 到单个端点」，协议面很薄，手写零风险、零新依赖。

支持的方法：initialize / ping / tools/list / tools/call / notifications/*

鉴权：沿用外部控制独立密钥，两种头任一通过即可（兼容不同 MCP 客户端）：
- Authorization: Bearer <token>
- X-External-Token: <token>

端点：POST /api/v2/ext/mcp
"""
import inspect
import json as _json
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from src.api.v2.endpoints import external_control as ext

logger = logging.getLogger(__name__)
router = APIRouter()

PROTOCOL_VERSION = "2024-11-05"
SERVER_NAME = "dd-danmaku-control"
SERVER_VERSION = "1.0.0"

# ---------- 工具注册表 ----------
# 只登记「MCP 工具名 → 外部控制端点函数」的映射，说明与入参 schema 全部
# 从函数本身反射生成（docstring + 类型注解 + 默认值），避免抄第二份。
# 新增 ext 诊断接口时，这里加一行即可。
_TOOL_HANDLERS: Dict[str, Any] = {
    "diag_snapshot": ext.diag_snapshot,
    "diag_system": ext.diag_system,
    "diag_eventloop": ext.diag_eventloop,
    "diag_queues": ext.diag_queues,
    "diag_db_pool": ext.diag_db_pool,
    "diag_control": ext.diag_control,
    "diag_slow_sql": ext.diag_slow_sql,
    "diag_slow_sql_reset": ext.diag_slow_sql_reset,
}

# 鉴权依赖参数的形参名约定（以下划线开头），反射时跳过：
# MCP 入口已统一校验密钥，不该暴露给 AI 当工具参数。
_AUTH_PARAM_PREFIX = "_"

# Python 类型 → JSON Schema 类型
_TYPE_MAP = {int: "integer", float: "number", bool: "boolean", str: "string"}


def _build_description(handler) -> str:
    """从端点函数的 docstring 提取工具说明

    docstring 是业务说明的唯一来源。这里做的处理：
    - 去掉每行公共缩进（textwrap.dedent 后再 strip）
    - 剔除"参数："段落（入参信息已由 inputSchema 表达，重复反而噪音）
    """
    doc = inspect.getdoc(handler) or ""
    lines = []
    for line in doc.splitlines():
        # 遇到参数说明段就停（inputSchema 里已有结构化描述）
        if line.strip().startswith(("参数：", "参数:", "Args:")):
            break
        lines.append(line)
    return "\n".join(lines).strip()


def _build_input_schema(handler) -> dict:
    """从端点函数签名反射生成 JSON Schema

    - 跳过鉴权依赖参数（下划线开头）
    - 用类型注解推断 JSON 类型，用默认值填 default
    - 无默认值的参数进 required
    """
    props: Dict[str, Any] = {}
    required: list = []
    for name, param in inspect.signature(handler).parameters.items():
        if name.startswith(_AUTH_PARAM_PREFIX):
            continue
        schema: Dict[str, Any] = {
            "type": _TYPE_MAP.get(param.annotation, "string"),
        }
        if param.default is inspect.Parameter.empty:
            required.append(name)
        else:
            schema["default"] = param.default
        props[name] = schema
    out: Dict[str, Any] = {"type": "object", "properties": props}
    if required:
        out["required"] = required
    return out


def _build_tools() -> list:
    """构建 MCP 工具清单（模块加载时算一次，说明/schema 全部来自 ext 端点函数）"""
    tools = []
    for name, handler in _TOOL_HANDLERS.items():
        tools.append({
            "name": name,
            "description": _build_description(handler),
            "inputSchema": _build_input_schema(handler),
        })
    return tools


_TOOLS: list = _build_tools()


def public_tools() -> list:
    """对外工具清单（_TOOLS 本身已只含协议字段，直接返回）"""
    return _TOOLS


async def _verify(authorization: Optional[str], x_external_token: Optional[str]) -> None:
    """校验外部控制密钥；两种头任一通过即可"""
    import asyncio
    from src.services_v2.external_control_service import external_control_auth

    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    elif x_external_token:
        token = x_external_token.strip()
    if not token:
        raise HTTPException(status_code=401, detail="缺少外部控制密钥")
    ok = await asyncio.to_thread(external_control_auth.verify, token)
    if not ok:
        raise HTTPException(status_code=401, detail="外部控制密钥无效")


async def _call_tool(name: str, args: Dict[str, Any]) -> Any:
    """调用工具：转发到对应的外部控制端点函数，取出其返回的业务数据

    - 鉴权参数（形如 `_: bool = Depends(verify_external_token)`）在 MCP 入口
      已统一校验过，这里按形参名过滤掉，只透传工具真正的业务入参；
    - ext 端点统一返回 ApiResult，此处解包出 data（无 data 的取 message，
      如 reset 类接口），保证 MCP 侧看到的就是纯业务结果。
    """
    handler = _TOOL_HANDLERS.get(name)
    if handler is None:
        raise ValueError(f"未知工具: {name}")

    kwargs = {}
    for pname, param in inspect.signature(handler).parameters.items():
        # 跳过鉴权依赖参数（MCP 入口已统一校验密钥）
        if pname.startswith(_AUTH_PARAM_PREFIX):
            continue
        if pname in args and args[pname] is not None:
            kwargs[pname] = args[pname]
        elif param.default is inspect.Parameter.empty:
            raise ValueError(f"工具 {name} 缺少必填参数: {pname}")

    result = handler(**kwargs)
    if inspect.isawaitable(result):
        result = await result

    # 解包 ApiResult：优先 data，其次 message（reset 类接口只返回 message）
    data = getattr(result, "data", None)
    if data is not None:
        return data
    message = getattr(result, "message", None)
    if message is not None:
        return {"message": message}
    return result


def _rpc_error(req_id: Any, code: int, message: str) -> dict:
    """构造 JSON-RPC 2.0 错误响应"""
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


async def _handle_rpc(msg: Any) -> Optional[dict]:
    """处理单条 JSON-RPC 消息；返回 None 表示这是通知（按规范不回响应）"""
    if not isinstance(msg, dict):
        return _rpc_error(None, -32600, "请求格式无效")

    method = msg.get("method") or ""
    req_id = msg.get("id")
    params = msg.get("params") or {}

    # 通知（notifications/initialized 等）没有 id，不回响应
    if req_id is None:
        return None

    if method == "initialize":
        return {
            "jsonrpc": "2.0", "id": req_id,
            "result": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            },
        }

    if method == "ping":
        return {"jsonrpc": "2.0", "id": req_id, "result": {}}

    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": public_tools()}}

    if method == "tools/call":
        name = params.get("name") or ""
        args = params.get("arguments") or {}
        try:
            data = await _call_tool(name, args)
        except ValueError as e:
            # 工具名/参数错误属于调用方问题，用 JSON-RPC 参数错误码
            return _rpc_error(req_id, -32602, str(e))
        except HTTPException as e:
            return _rpc_error(req_id, -32603, f"接口返回错误: {e.detail}")
        except Exception as e:
            logger.warning(f"⚠️ MCP 工具执行失败 {name}: {e}")
            # 工具内部执行失败按 MCP 规范放 result.isError，让 AI 能看到原因
            return {
                "jsonrpc": "2.0", "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": f"工具执行失败: {e}"}],
                    "isError": True,
                },
            }
        return {
            "jsonrpc": "2.0", "id": req_id,
            "result": {
                "content": [{
                    "type": "text",
                    "text": _json.dumps(data, ensure_ascii=False, indent=2, default=str),
                }],
                "isError": False,
            },
        }

    return _rpc_error(req_id, -32601, f"未实现的方法: {method}")


@router.post("/mcp")
async def mcp_http(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_external_token: Optional[str] = Header(None),
):
    """MCP Streamable HTTP 端点：接收 JSON-RPC 2.0 请求

    通知类消息（无 id）按规范返回 202 空响应，不回 JSON-RPC 结果。
    """
    await _verify(authorization, x_external_token)

    try:
        body = await request.json()
    except Exception:
        return JSONResponse(_rpc_error(None, -32700, "JSON 解析失败"), status_code=400)

    # 批量请求：逐条处理，通知不产生响应项
    if isinstance(body, list):
        results = []
        for item in body:
            r = await _handle_rpc(item)
            if r is not None:
                results.append(r)
        return JSONResponse(results) if results else JSONResponse(None, status_code=202)

    result = await _handle_rpc(body)
    if result is None:
        return JSONResponse(None, status_code=202)
    return JSONResponse(result)


@router.get("/mcp")
async def mcp_http_get(
    authorization: Optional[str] = Header(None),
    x_external_token: Optional[str] = Header(None),
):
    """GET 探测：部分客户端会先 GET 确认端点可用。

    本实现不提供 SSE 长连接（诊断工具都是请求-响应式，不需要服务端主动推送），
    故返回端点元信息而非 event-stream。
    """
    await _verify(authorization, x_external_token)
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
        "transport": "streamable-http",
        "note": "POST JSON-RPC 2.0 到本端点；不支持 SSE 推送",
        "tools": [t["name"] for t in _TOOLS],
    }