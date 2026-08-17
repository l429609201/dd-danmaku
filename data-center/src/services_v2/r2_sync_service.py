"""R2 弹幕存量扫描与复制到本地端。"""
import asyncio
import logging
from typing import Any, Dict

from src.services_v2.comment_store_service import comment_store_service
from src.services_v2.control_client import control_client

logger = logging.getLogger(__name__)


class R2SyncService:
    """单进程后台任务；扫描与同步互斥，避免重复遍历整个 R2。"""

    def __init__(self):
        self._task = None
        self._status = self._idle_status()

    @staticmethod
    def _idle_status() -> Dict[str, Any]:
        return {
            "running": False, "mode": None, "phase": "idle",
            "objects": 0, "total_bytes": 0, "processed": 0,
            "saved": 0, "skipped": 0, "errors": 0,
            "current_episode_id": None, "message": "尚未扫描",
        }

    def status(self) -> Dict[str, Any]:
        return dict(self._status)

    def start(self, mode: str) -> bool:
        if self._task and not self._task.done():
            return False
        self._status = self._idle_status()
        self._status.update({
            "running": True, "mode": mode, "phase": "listing",
            "message": "正在扫描 R2 存量",
        })
        self._task = asyncio.create_task(self._run(mode))
        return True

    async def _run(self, mode: str):
        cursor = None
        try:
            while True:
                page = await control_client.request(
                    "r2.comment.list", {"cursor": cursor, "limit": 1000}, timeout=10.0)
                if not page or not page.get("hit"):
                    raise RuntimeError((page or {}).get("error") or "Worker/R2 不可用")
                objects = page.get("objects") or []
                self._status["objects"] += len(objects)
                self._status["total_bytes"] += sum(int(x.get("size") or 0) for x in objects)
                if mode == "sync" and objects:
                    self._status.update({"phase": "syncing", "message": "正在复制 R2 弹幕到本地"})
                    # 小并发兼顾同步速度与长连接 pending RPC 水位。
                    for start in range(0, len(objects), 8):
                        await asyncio.gather(*[
                            self._copy_object(obj) for obj in objects[start:start + 8]
                        ])
                cursor = page.get("cursor")
                if not cursor:
                    break
            self._status.update({
                "running": False, "phase": "completed",
                "message": "同步完成" if mode == "sync" else "扫描完成",
                "current_episode_id": None,
            })
        except Exception as exc:
            logger.error("❌ R2 存量任务失败: %s", exc)
            self._status.update({
                "running": False, "phase": "failed",
                "message": str(exc), "current_episode_id": None,
            })

    async def _copy_object(self, obj: Dict[str, Any]):
        key = str(obj.get("key") or "")
        episode_id = key[len("comment/"):] if key.startswith("comment/") else ""
        self._status["current_episode_id"] = episode_id or key
        if not episode_id:
            self._status["errors"] += 1
            self._status["processed"] += 1
            return
        try:
            result = await control_client.request(
                "r2.comment.get",
                {"episode_id": episode_id, "include_expired": True},
                timeout=10.0,
            )
            if not result or not result.get("hit") or not result.get("body"):
                self._status["errors"] += 1
                return
            archived = await asyncio.to_thread(
                comment_store_service.archive, episode_id, result["body"], "r2_sync")
            if archived.get("saved"):
                self._status["saved"] += 1
            else:
                self._status["skipped"] += 1
        except Exception as exc:
            logger.warning("⚠️ R2 对象复制失败 %s: %s", episode_id, exc)
            self._status["errors"] += 1
        finally:
            self._status["processed"] += 1


r2_sync_service = R2SyncService()
