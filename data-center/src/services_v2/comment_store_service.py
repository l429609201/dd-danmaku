"""
本地端弹幕兜底持久化存储服务（架构B）

R2 为一级实时缓存，本地端为兜底持久化：
- archive：弹幕回源/清理时存到文件系统 + 元数据表，以弹幕条数为准更新（条数更多才覆盖）
- get：429 或 R2 无对象时按 episode_id 读取
- 总量上限 LRU 控制，防止磁盘膨胀
"""
import json
import logging
import os
from typing import Any, Dict, Optional

from sqlalchemy import func

from src.database import get_db_sync
from src.models_v2 import LocalCommentStore
from src.models_v2.base import now

logger = logging.getLogger(__name__)

# 弹幕文件存储目录（与 config 同卷，持久化）
DANMAKU_DIR = os.getenv("DANMAKU_STORE_DIR", "/app/config/danmaku")
# 总量上限（字节），默认 5GB
MAX_STORE_BYTES = int(os.getenv("DANMAKU_STORE_MAX_BYTES", str(5 * 1024 * 1024 * 1024)))


class CommentStoreService:
    """弹幕兜底持久化"""

    def __init__(self):
        os.makedirs(DANMAKU_DIR, exist_ok=True)

    def _file_path(self, episode_id: str) -> str:
        safe = "".join(c for c in str(episode_id) if c.isalnum() or c in "-_")
        return os.path.join(DANMAKU_DIR, f"{safe}.json")

    @staticmethod
    def _count_comments(body: str) -> int:
        """解析弹幕条数，失败返回 0"""
        try:
            data = json.loads(body)
            c = data.get("comments") if isinstance(data, dict) else None
            return len(c) if isinstance(c, list) else 0
        except Exception:
            return 0

    def archive(self, episode_id: str, body: str,
                source: str = "r2_archive") -> Dict[str, Any]:
        """存弹幕：以条数为准更新（新条数 >= 旧才覆盖），返回结果摘要"""
        episode_id = str(episode_id).strip()
        if not episode_id or not body:
            return {"saved": False, "reason": "empty"}
        new_count = self._count_comments(body)
        db = get_db_sync()
        try:
            row = db.query(LocalCommentStore).filter(
                LocalCommentStore.episode_id == episode_id
            ).first()
            # 已存在且旧条数更多 → 不覆盖（避免残缺响应污染）
            if row and new_count < (row.comment_count or 0):
                return {"saved": False, "reason": "fewer_comments",
                        "old": row.comment_count, "new": new_count}

            path = self._file_path(episode_id)
            with open(path, "w", encoding="utf-8") as f:
                f.write(body)
            size = os.path.getsize(path)
            current = now()
            if not row:
                row = LocalCommentStore(episode_id=episode_id, file_path=path)
                db.add(row)
            row.file_path = path
            row.size_bytes = size
            row.comment_count = new_count
            row.source = source
            row.updated_at = current
            db.commit()
            self._enforce_limit(db)
            return {"saved": True, "comment_count": new_count, "size": size}
        except Exception as e:
            db.rollback()
            logger.error(f"❌ 弹幕 archive 失败 {episode_id}: {e}")
            return {"saved": False, "reason": str(e)}
        finally:
            db.close()

    def get(self, episode_id: str) -> Optional[Dict[str, Any]]:
        """读弹幕兜底：命中返回 body + 元数据，并更新 last_used_at"""
        episode_id = str(episode_id).strip()
        if not episode_id:
            return None
        db = get_db_sync()
        try:
            row = db.query(LocalCommentStore).filter(
                LocalCommentStore.episode_id == episode_id
            ).first()
            if not row or not os.path.exists(row.file_path):
                return None
            with open(row.file_path, "r", encoding="utf-8") as f:
                body = f.read()
            row.last_used_at = now()
            db.commit()
            return {"hit": True, "body": body,
                    "comment_count": row.comment_count}
        except Exception as e:
            logger.warning(f"⚠️ 弹幕 get 失败 {episode_id}: {e}")
            return None
        finally:
            db.close()

    def _enforce_limit(self, db):
        """总量超上限时按 last_used_at LRU 删最旧（NULL 视为最久）"""
        try:
            total = db.query(
                func.coalesce(func.sum(LocalCommentStore.size_bytes), 0)
            ).scalar() or 0
            if total <= MAX_STORE_BYTES:
                return
            rows = db.query(LocalCommentStore).order_by(
                LocalCommentStore.last_used_at.asc().nullsfirst()
            ).all()
            for r in rows:
                if total <= MAX_STORE_BYTES:
                    break
                try:
                    if os.path.exists(r.file_path):
                        os.remove(r.file_path)
                except Exception:
                    pass
                total -= (r.size_bytes or 0)
                db.delete(r)
            db.commit()
        except Exception as e:
            db.rollback()
            logger.warning(f"⚠️ 弹幕存储 LRU 清理失败: {e}")


comment_store_service = CommentStoreService()
