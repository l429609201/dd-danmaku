"""
Worker 请求日志文件存储（轮转 JSONL）

替代原先的 worker_request_logs 表：该表在现网涨到 3.2 GB / 58 万行，
主因是每行都带 request_body / response_body 两个 4 KB 大字段，
按行数清理跟不上写入速度，持续挤压数据库。

选 JSONL 而非纯文本：每行一个完整 JSON，既保留结构化字段
（可按 level/ip/ua/status 精确筛选），也能直接被 grep。

轮转策略 20 MB × 10 = 200 MB 上限，由 RotatingFileHandler 负责，
写满自动切 worker.log.1 ~ worker.log.10，无需额外清理任务。
"""
import json
import logging
import os
import threading
from logging.handlers import RotatingFileHandler
from typing import Any, Dict, Iterator, List, Optional

logger = logging.getLogger(__name__)

LOG_FILE_NAME = "worker.log"
# 单文件 20 MB，保留 10 个备份（含当前文件共约 200 MB）
ROTATE_SIZE_MB = 20
ROTATE_BACKUPS = 10


def _resolve_log_dir() -> str:
    """与 logger_setup 保持一致的日志目录解析逻辑"""
    if os.path.exists("/app/config"):
        return "/app/config/logs"
    return os.path.join(os.getcwd(), "logs")


class WorkerLogFileService:
    """Worker 日志文件写入与检索"""

    def __init__(self):
        self._handler: Optional[RotatingFileHandler] = None
        self._lock = threading.Lock()
        self._meta_lock = threading.Lock()
        self._log_dir = _resolve_log_dir()
        self._written = 0
        # 按文件身份缓存元信息；轮转改名后 inode 不变，可直接复用。
        self._meta_cache: Dict[Any, Dict[str, Any]] = {}

    # ---------- 写入 ----------
    def _ensure_handler(self) -> Optional[RotatingFileHandler]:
        """惰性创建 handler；目录不可写时返回 None（降级为丢弃，不影响主流程）"""
        if self._handler is not None:
            return self._handler
        with self._lock:
            if self._handler is not None:
                return self._handler
            try:
                os.makedirs(self._log_dir, exist_ok=True)
                h = RotatingFileHandler(
                    os.path.join(self._log_dir, LOG_FILE_NAME),
                    maxBytes=ROTATE_SIZE_MB * 1024 * 1024,
                    backupCount=ROTATE_BACKUPS,
                    encoding="utf-8",
                )
                # 只写裸消息：内容本身已是完整 JSON，不需要 logging 的前缀
                h.setFormatter(logging.Formatter("%(message)s"))
                self._handler = h
                logger.info(
                    f"📄 Worker 日志文件已就绪: {self._log_dir}/{LOG_FILE_NAME} "
                    f"（轮转 {ROTATE_SIZE_MB}MB × {ROTATE_BACKUPS}）")
            except Exception as e:
                logger.warning(f"⚠️ Worker 日志文件初始化失败（日志将丢弃）: {e}")
                return None
        return self._handler

    def append_many(self, rows: List[Dict[str, Any]]) -> int:
        """批量追加日志行；返回成功写入条数。"""
        h = self._ensure_handler()
        if h is None or not rows:
            return 0
        count = 0
        # RotatingFileHandler 自身不保证多线程下轮转安全，加锁串行化
        with self._lock:
            for row in rows:
                try:
                    line = json.dumps(row, ensure_ascii=False)
                    h.emit(logging.LogRecord(
                        name="worker", level=logging.INFO, pathname="",
                        lineno=0, msg=line, args=(), exc_info=None,
                    ))
                    count += 1
                except Exception:
                    continue
        self._written += count
        return count

    def stats(self) -> dict:
        """可观测：累计写入条数与各轮转文件元信息"""
        return {
            "written": self._written,
            "log_dir": self._log_dir,
            "files": self.list_files(),
        }

    # ---------- 文件元信息 ----------
    @staticmethod
    def _file_identity(path: str, st) -> tuple:
        """用设备号+inode识别文件；平台不提供 inode 时回退绝对路径。"""
        inode = getattr(st, "st_ino", 0)
        return (getattr(st, "st_dev", 0), inode, "" if inode else path)

    @staticmethod
    def _line_time(raw: Optional[bytes]) -> Optional[str]:
        if not raw:
            return None
        try:
            return json.loads(raw.decode("utf-8", errors="replace")).get("created_at")
        except Exception:
            return None

    def _file_metadata(self, path: str, st) -> Dict[str, Any]:
        """首次扫全文件；后续只扫描新增字节并更新行数/时间范围。"""
        identity = self._file_identity(path, st)
        with self._meta_lock:
            cached = self._meta_cache.get(identity)
            mtime_ns = getattr(st, "st_mtime_ns", int(st.st_mtime * 1_000_000_000))
            if (cached and cached["observed_size"] == st.st_size
                    and cached["mtime_ns"] == mtime_ns):
                return dict(cached)
            # 只有尺寸严格增长才视为追加；同尺寸但 mtime 变化可能是外部重写。
            can_increment = bool(
                cached and st.st_size > cached["observed_size"]
                and cached["scanned_bytes"] <= cached["observed_size"])
            start = cached["scanned_bytes"] if can_increment else 0
            line_count = cached["line_count"] if can_increment else 0
            first_at = cached["first_at"] if can_increment else None
            last_at = cached["last_at"] if can_increment else None
            first_new = last_new = None
            scanned = start
            with open(path, "rb") as file_obj:
                file_obj.seek(start)
                while True:
                    line_start = file_obj.tell()
                    raw = file_obj.readline()
                    if not raw:
                        scanned = file_obj.tell()
                        break
                    if not raw.endswith(b"\n"):
                        # 写入线程可能尚未完成当前 JSONL 行；下次从该行起点补扫。
                        scanned = line_start
                        break
                    raw = raw.strip()
                    if not raw:
                        scanned = file_obj.tell()
                        continue
                    line_count += 1
                    if first_new is None:
                        first_new = raw
                    last_new = raw
                    scanned = file_obj.tell()
            first_at = first_at or self._line_time(first_new)
            last_at = self._line_time(last_new) or last_at
            meta = {
                "size_bytes": st.st_size,
                "observed_size": st.st_size,
                "mtime_ns": mtime_ns,
                "scanned_bytes": scanned,
                "line_count": line_count,
                "first_at": first_at,
                "last_at": last_at,
            }
            self._meta_cache[identity] = meta
            return dict(meta)

    # ---------- 检索 ----------
    def list_files(self) -> List[Dict[str, Any]]:
        """列出轮转文件及缓存的行数、首末时间（当前文件在前）。"""
        out: List[Dict[str, Any]] = []
        seen = set()
        try:
            for i in range(0, ROTATE_BACKUPS + 1):
                name = LOG_FILE_NAME if i == 0 else f"{LOG_FILE_NAME}.{i}"
                path = os.path.join(self._log_dir, name)
                if not os.path.exists(path):
                    continue
                st = os.stat(path)
                identity = self._file_identity(path, st)
                seen.add(identity)
                meta = self._file_metadata(path, st)
                out.append({
                    "name": name,
                    "size_bytes": meta["size_bytes"],
                    "size_mb": round(meta["size_bytes"] / 1024 / 1024, 2),
                    "line_count": meta["line_count"],
                    "first_at": meta["first_at"],
                    "last_at": meta["last_at"],
                    "modified_at": int(st.st_mtime * 1000),
                    "is_current": i == 0,
                })
            with self._meta_lock:
                self._meta_cache = {
                    key: value for key, value in self._meta_cache.items() if key in seen}
        except Exception as e:
            logger.warning(f"⚠️ 读取 Worker 日志文件列表失败: {e}")
        return out

    def _safe_path(self, name: Optional[str]) -> Optional[str]:
        """校验文件名合法性，防路径穿越；None/空 表示当前文件"""
        if not name:
            name = LOG_FILE_NAME
        allowed = {LOG_FILE_NAME} | {
            f"{LOG_FILE_NAME}.{i}" for i in range(1, ROTATE_BACKUPS + 1)}
        if name not in allowed:
            return None
        path = os.path.join(self._log_dir, name)
        return path if os.path.exists(path) else None

    def _iter_lines_reversed(self, path: str,
                             chunk_size: int = 64 * 1024) -> Iterator[str]:
        """从文件尾部反向逐行读取（日志按时间正序追加，倒序即最新优先）。

        分块读取，避免把整个 20 MB 文件load进内存。
        """
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            pos = f.tell()
            tail = b""
            while pos > 0:
                read_size = min(chunk_size, pos)
                pos -= read_size
                f.seek(pos)
                buf = f.read(read_size) + tail
                parts = buf.split(b"\n")
                tail = parts[0]
                for raw in reversed(parts[1:]):
                    if raw.strip():
                        yield raw.decode("utf-8", errors="replace")
            if tail.strip():
                yield tail.decode("utf-8", errors="replace")

    @staticmethod
    def _match(row: Dict[str, Any], level: Optional[str],
               keyword: Optional[str], ip: Optional[str],
               ua: Optional[str], user_id: Optional[str],
               status: Optional[int]) -> bool:
        """逐条匹配筛选条件（全部为 AND 关系，空条件跳过）"""
        if level and str(row.get("level", "")).upper() != level.upper():
            return False
        if status is not None and row.get("status") != status:
            return False
        if ip and ip not in str(row.get("client_ip") or ""):
            return False
        if ua and ua not in str(row.get("ua_type") or ""):
            return False
        if user_id and user_id not in str(row.get("client_user_id") or ""):
            return False
        if keyword:
            # 关键词跨多个字段搜：路径、搜索词、消息、请求/响应体
            kw = keyword.lower()
            haystack = " ".join(str(row.get(k) or "") for k in (
                "path", "query", "message", "request_body", "response_body"))
            if kw not in haystack.lower():
                return False
        return True

    def search(self, file_name: Optional[str] = None,
               level: Optional[str] = None, keyword: Optional[str] = None,
               ip: Optional[str] = None, ua: Optional[str] = None,
               user_id: Optional[str] = None, status: Optional[int] = None,
               page: int = 1, page_size: int = 50,
               max_scan: int = 200000) -> Dict[str, Any]:
        """在指定轮转文件内检索日志（倒序：最新在前）。

        与原 SQL 版的差异：
        - total 是「本文件内实际匹配数」，扫描到 max_scan 行为止（防超大文件卡死），
          截断时 total_estimated=True，前端据此显示「约 N 条」。
        - 只在单个文件内检索：跨文件需前端切换，避免一次扫 200 MB。
        """
        path = self._safe_path(file_name)
        if path is None:
            return {"total": 0, "items": [], "total_estimated": False,
                    "scanned": 0, "file": file_name or LOG_FILE_NAME}

        has_filter = any([level, keyword, ip, ua, user_id, status is not None])
        start = (max(1, page) - 1) * page_size
        end = start + page_size

        items: List[Dict[str, Any]] = []
        matched = 0
        scanned = 0
        truncated = False
        try:
            for line in self._iter_lines_reversed(path):
                scanned += 1
                if scanned > max_scan:
                    truncated = True
                    break
                try:
                    row = json.loads(line)
                except Exception:
                    continue
                if has_filter and not self._match(
                        row, level, keyword, ip, ua, user_id, status):
                    continue
                # 落在当前页区间内才收集，其余只计数
                if start <= matched < end:
                    items.append(row)
                matched += 1
                # 无筛选条件时不必扫全文件：凑满当前页即可返回
                if not has_filter and matched >= end:
                    truncated = True
                    break
        except Exception as e:
            logger.warning(f"⚠️ 检索 Worker 日志文件失败: {e}")

        return {
            "total": matched,
            "items": items,
            # 扫描被截断时 total 不是精确值
            "total_estimated": truncated,
            "scanned": scanned,
            "file": os.path.basename(path),
        }


worker_log_file_service = WorkerLogFileService()
