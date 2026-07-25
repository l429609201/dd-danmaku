"""
应用日志文件轮转与读取服务

原本日志只输出到 stdout（docker logs），程序内无法回读，异常堆栈只能靠人去
翻容器日志。这里补一个 RotatingFileHandler 落盘，并提供 tail / 正则过滤读取，
让外部诊断接口（/ext/logs/app）与 MCP 能直接查到应用日志。

落盘位置：{CONFIG_PATH}/logs/app.log，轮转 20MB × 5 份（约 100MB 上限）。

读取实现要点：
- tail 用「从文件尾部反向分块读」，不把整个文件读进内存；
- 跨轮转文件按 app.log → app.log.1 → ... 顺序回溯，保证能查到更早的日志；
- 编码错误用 errors="replace" 兜住，避免半个多字节字符导致读取失败。
"""
import logging
import logging.handlers
import os
import re
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger(__name__)

# 轮转参数：单文件 20MB，保留 5 个备份
MAX_BYTES = 20 * 1024 * 1024
BACKUP_COUNT = 5
LOG_FILENAME = "app.log"

_log_dir: Optional[Path] = None
_installed = False


def install(config_path: str) -> Optional[str]:
    """在 root logger 上挂 RotatingFileHandler（幂等）

    返回日志文件绝对路径；目录不可写等失败时返回 None（不阻断启动）。
    """
    global _log_dir, _installed
    if _installed:
        return str(_log_dir / LOG_FILENAME) if _log_dir else None
    try:
        log_dir = Path(config_path) / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        path = log_dir / LOG_FILENAME
        handler = logging.handlers.RotatingFileHandler(
            path, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8",
        )
        handler.setFormatter(logging.Formatter(
            "%(asctime)s %(levelname)s [%(name)s] %(message)s"
        ))
        root = logging.getLogger()
        handler.setLevel(root.level or logging.INFO)
        root.addHandler(handler)
        _log_dir = log_dir
        _installed = True
        logger.info(f"📄 应用日志已落盘: {path}（{MAX_BYTES // 1048576}MB × {BACKUP_COUNT}）")
        return str(path)
    except Exception as e:
        logger.warning(f"⚠️ 应用日志落盘失败（仅影响 /ext/logs/app 查询）: {e}")
        return None


def _rotated_files() -> List[Path]:
    """按「新→旧」顺序返回存在的日志文件：app.log, app.log.1, ..."""
    if _log_dir is None:
        return []
    files = [_log_dir / LOG_FILENAME]
    for i in range(1, BACKUP_COUNT + 1):
        files.append(_log_dir / f"{LOG_FILENAME}.{i}")
    return [f for f in files if f.exists()]


def _tail_lines(path: Path, limit: int) -> List[str]:
    """从文件尾部反向读取最多 limit 行（不整文件载入内存）"""
    chunk = 64 * 1024
    try:
        size = path.stat().st_size
    except OSError:
        return []
    if size == 0:
        return []
    buf = b""
    pos = size
    with path.open("rb") as f:
        while pos > 0 and buf.count(b"\n") <= limit:
            step = min(chunk, pos)
            pos -= step
            f.seek(pos)
            buf = f.read(step) + buf
    text = buf.decode("utf-8", errors="replace")
    lines = text.splitlines()
    return lines[-limit:] if len(lines) > limit else lines


def read_logs(limit: int = 200, pattern: Optional[str] = None,
              level: Optional[str] = None) -> dict:
    """读取应用日志尾部

    参数：
        limit   返回行数上限（1~2000）
        pattern 正则过滤（对整行匹配，忽略大小写）；非法正则退化为纯文本包含
        level   仅返回该级别的行（ERROR/WARNING/INFO/DEBUG）
    """
    limit = max(1, min(int(limit or 200), 2000))
    if not _installed or _log_dir is None:
        return {"available": False,
                "note": "应用日志未落盘（install 未成功或目录不可写）",
                "lines": []}

    matcher = None
    if pattern:
        try:
            matcher = re.compile(pattern, re.IGNORECASE)
        except re.error:
            # 非法正则时退化为普通包含匹配，避免直接报错
            kw = pattern.lower()
            matcher = type("_Plain", (), {
                "search": staticmethod(lambda s, _kw=kw: _kw in s.lower())
            })()

    lvl = (level or "").upper().strip()
    collected: List[str] = []
    # 从最新文件往旧文件回溯，直到攒够 limit 行
    for path in _rotated_files():
        need = limit - len(collected)
        if need <= 0:
            break
        # 有过滤条件时多读一些原始行，提高命中率
        raw_limit = need if not (matcher or lvl) else min(need * 50, 20000)
        lines = _tail_lines(path, raw_limit)
        picked = []
        for line in lines:
            if lvl and f" {lvl} " not in line:
                continue
            if matcher and not matcher.search(line):
                continue
            picked.append(line)
        # 越旧的日志排在越前面
        collected = picked[-need:] + collected
    return {
        "available": True,
        "file": str(_log_dir / LOG_FILENAME),
        "returned": len(collected),
        "limit": limit,
        "filters": {"pattern": pattern, "level": lvl or None},
        "lines": collected,
    }