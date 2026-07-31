"""
只读 SQL 查询服务（供外部诊断 / MCP 使用）

目的：让诊断方能直接查表行数、跑 EXPLAIN 看索引是否生效，而不必人工登库。

安全边界（多层，任一层拦住即拒绝）：
1. 语句白名单：只允许 SELECT / WITH / EXPLAIN / SHOW / DESC 开头
2. 单语句：剔除末尾分号后，若仍含分号一律拒绝（防叠加写语句）
3. 关键字黑名单：出现 INSERT/UPDATE/DELETE/DROP/ALTER 等写操作词即拒绝
4. 强制行数上限：结果集超过 max_rows 直接截断，避免拖爆内存
5. 只读事务：在事务里执行并始终 rollback，即使绕过前几层也无法落盘
6. 敏感列脱敏：列名命中 secret/token/password/app_secret 等一律替换为 ***

第 6 层是「表可查、密钥不可见」的关键：不禁止查 sign_key_pool 这类表
（行数、更新时间对排查有用），但其密钥列的值不会返回。
"""
import logging
import re
from typing import Any, Dict, List

from sqlalchemy import text

from src.database import engine

logger = logging.getLogger(__name__)

# 允许的语句起始关键字（只读语义）
_ALLOWED_PREFIX = ("select", "with", "explain", "show", "desc", "describe")

# 写操作 / DDL 关键字黑名单（按词边界匹配，避免误伤 "selected" 这类列名）
_DENY_KEYWORDS = (
    "insert", "update", "delete", "drop", "alter", "create", "truncate",
    "replace", "grant", "revoke", "commit", "rollback", "savepoint",
    "lock", "unlock", "call", "execute", "prepare", "set", "load",
    "outfile", "dumpfile", "into",
)

# 敏感列名片段：列名（小写）包含任一片段时，该列值一律脱敏
_SENSITIVE_FRAGMENTS = (
    "secret", "token", "password", "passwd", "pwd", "hashed",
    "private_key", "api_key", "app_secret", "credential", "salt",
)

MASK = "***REDACTED***"
DEFAULT_MAX_ROWS = 200
HARD_MAX_ROWS = 1000


def _is_sensitive(column: str) -> bool:
    """列名是否命中敏感片段"""
    low = (column or "").lower()
    return any(frag in low for frag in _SENSITIVE_FRAGMENTS)


def validate(sql: str) -> str:
    """校验 SQL 只读合法性；不合法抛 ValueError，合法则返回规范化后的语句"""
    if not sql or not sql.strip():
        raise ValueError("SQL 不能为空")
    stmt = sql.strip()
    # 去掉末尾分号（单条语句允许以分号结尾）
    stmt = stmt.rstrip().rstrip(";").strip()
    if ";" in stmt:
        raise ValueError("只允许执行单条语句（检测到多余分号）")

    low = stmt.lower()
    if not low.startswith(_ALLOWED_PREFIX):
        raise ValueError(
            f"只允许只读语句（{'/'.join(_ALLOWED_PREFIX)} 开头），实际以 "
            f"'{stmt.split()[0] if stmt.split() else '?'}' 开头"
        )

    # 去掉字符串字面量再查关键字，避免 WHERE name='update' 被误判
    stripped = re.sub(r"'[^']*'|\"[^\"]*\"", "''", low)
    for kw in _DENY_KEYWORDS:
        if re.search(rf"\b{kw}\b", stripped):
            raise ValueError(f"检测到禁止的关键字: {kw}（本接口仅支持只读查询）")
    # 注释可用于拼接绕过，一并拒绝
    if "--" in stripped or "/*" in stripped:
        raise ValueError("不允许包含 SQL 注释")
    return stmt


def run_query(sql: str, max_rows: int = DEFAULT_MAX_ROWS) -> Dict[str, Any]:
    """执行只读查询（同步，调用方放线程池）

    返回 { columns, rows, row_count, truncated, masked_columns, sql }。
    在事务内执行并强制 rollback，保证不产生任何持久化副作用。
    """
    stmt = validate(sql)
    limit = max(1, min(int(max_rows or DEFAULT_MAX_ROWS), HARD_MAX_ROWS))

    conn = engine.connect()
    trans = conn.begin()
    try:
        result = conn.execute(text(stmt))
        columns = list(result.keys()) if result.returns_rows else []
        masked = [c for c in columns if _is_sensitive(c)]
        mask_idx = {i for i, c in enumerate(columns) if _is_sensitive(c)}

        rows: List[List[Any]] = []
        truncated = False
        if result.returns_rows:
            fetched = result.fetchmany(limit + 1)
            if len(fetched) > limit:
                truncated = True
                fetched = fetched[:limit]
            for r in fetched:
                row = []
                for i, v in enumerate(r):
                    if i in mask_idx and v is not None:
                        row.append(MASK)
                    else:
                        # 非基础类型（datetime/Decimal 等）统一转字符串便于 JSON 化
                        row.append(v if isinstance(v, (int, float, bool, str, type(None)))
                                   else str(v))
                rows.append(row)
        return {
            "sql": stmt,
            "dialect": engine.dialect.name,
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
            "truncated": truncated,
            "max_rows": limit,
            # 明确告知哪些列被脱敏，避免误读为"值就是 ***"
            "masked_columns": masked,
        }
    finally:
        # 始终回滚：即使语句意外产生了变更也不会落盘
        try:
            trans.rollback()
        except Exception:
            pass
        conn.close()


def mask_mapping(data: Any) -> Any:
    """递归脱敏字典/列表里的敏感键（供 config_payload 等复用）

    与 run_query 的列脱敏共用同一份敏感片段规则。
    """
    if isinstance(data, dict):
        out = {}
        for k, v in data.items():
            if isinstance(k, str) and _is_sensitive(k):
                out[k] = MASK if v not in (None, "", [], {}) else v
            else:
                out[k] = mask_mapping(v)
        return out
    if isinstance(data, list):
        return [mask_mapping(x) for x in data]
    return data