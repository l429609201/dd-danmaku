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
from src.models_v2 import LocalCommentStore, AppSetting
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

    def get_max_bytes(self) -> int:
        """读取存储上限：优先 AppSetting(danmaku_store_max_bytes)，回退环境变量默认"""
        db = get_db_sync()
        try:
            s = db.query(AppSetting).filter(
                AppSetting.key == "danmaku_store_max_bytes").first()
            if s and s.value:
                try:
                    return max(0, int(s.value))
                except (TypeError, ValueError):
                    pass
            return MAX_STORE_BYTES
        finally:
            db.close()

    def set_max_bytes(self, max_bytes: int):
        """更新存储上限（写 AppSetting），并立即按新上限做一次 LRU 清理"""
        db = get_db_sync()
        try:
            s = db.query(AppSetting).filter(
                AppSetting.key == "danmaku_store_max_bytes").first()
            if s:
                s.value = str(max(0, max_bytes))
            else:
                db.add(AppSetting(key="danmaku_store_max_bytes",
                                  value=str(max(0, max_bytes))))
            db.commit()
            self._enforce_limit(db)
        finally:
            db.close()

    def _enforce_limit(self, db):
        """总量超上限时按 last_used_at LRU 删最旧（NULL 视为最久）"""
        try:
            max_bytes = self.get_max_bytes()
            total = db.query(
                func.coalesce(func.sum(LocalCommentStore.size_bytes), 0)
            ).scalar() or 0
            if total <= max_bytes:
                return
            rows = db.query(LocalCommentStore).order_by(
                LocalCommentStore.last_used_at.asc()
            ).all()
            for r in rows:
                if total <= max_bytes:
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

    def list_entries(self, page: int = 1, page_size: int = 20,
                     keyword: str = "", sort: str = "created_at") -> Dict[str, Any]:
        """分页列出弹幕条目，支持按 episode_id 搜索

        sort: created_at(存入时间,默认) / last_used_at(最近使用) / comment_count(弹幕数) / size_bytes(大小)
        """
        db = get_db_sync()
        try:
            q = db.query(LocalCommentStore)
            if keyword:
                q = q.filter(LocalCommentStore.episode_id.like(f"%{keyword}%"))
            total = q.count()
            sort_col = {
                "created_at": LocalCommentStore.created_at,
                "last_used_at": LocalCommentStore.last_used_at,
                "comment_count": LocalCommentStore.comment_count,
                "size_bytes": LocalCommentStore.size_bytes,
            }.get(sort, LocalCommentStore.created_at)
            rows = q.order_by(sort_col.desc()) \
                    .offset((page - 1) * page_size).limit(page_size).all()
            return {
                "total": total,
                "items": [{
                    "id": r.id, "episode_id": r.episode_id,
                    "size_bytes": r.size_bytes, "comment_count": r.comment_count,
                    "source": r.source,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                    "updated_at": r.updated_at.isoformat() if r.updated_at else None,
                    "last_used_at": r.last_used_at.isoformat() if r.last_used_at else None,
                } for r in rows],
            }
        finally:
            db.close()

    def get_detail(self, episode_id: str, offset: int = 0,
                   limit: int = 100) -> Optional[Dict[str, Any]]:
        """查看单条弹幕详情：元数据 + 弹幕分页预览（不更新 last_used_at，避免查看影响 LRU）

        offset/limit 支持前端滚动分批加载；total 为弹幕总条数。
        """
        episode_id = str(episode_id).strip()
        if not episode_id:
            return None
        offset = max(0, int(offset))
        limit = max(1, min(int(limit), 500))  # 单次最多 500 条，防响应过大
        db = get_db_sync()
        try:
            row = db.query(LocalCommentStore).filter(
                LocalCommentStore.episode_id == episode_id
            ).first()
            if not row:
                return None
            comments = []
            total = 0
            file_exists = os.path.exists(row.file_path)
            if file_exists:
                try:
                    with open(row.file_path, "r", encoding="utf-8") as f:
                        data = json.loads(f.read())
                    raw = data.get("comments") if isinstance(data, dict) else None
                    if isinstance(raw, list):
                        total = len(raw)
                        comments = raw[offset:offset + limit]
                except Exception as e:
                    logger.warning(f"⚠️ 弹幕详情解析失败 {episode_id}: {e}")
            return {
                "episode_id": row.episode_id,
                "file_path": row.file_path,
                "file_exists": file_exists,
                "size_bytes": row.size_bytes,
                "comment_count": row.comment_count,
                "source": row.source,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                "last_used_at": row.last_used_at.isoformat() if row.last_used_at else None,
                "preview": comments,
                "offset": offset,
                "limit": limit,
                "preview_total": total,
                "has_more": offset + limit < total,
            }
        finally:
            db.close()

    def delete_entry(self, episode_id: str) -> bool:
        """删除单条弹幕（文件+记录）"""
        db = get_db_sync()
        try:
            r = db.query(LocalCommentStore).filter(
                LocalCommentStore.episode_id == str(episode_id)).first()
            if not r:
                return False
            try:
                if os.path.exists(r.file_path):
                    os.remove(r.file_path)
            except Exception:
                pass
            db.delete(r)
            db.commit()
            return True
        finally:
            db.close()

    def clear_all(self) -> int:
        """清空全部弹幕（删文件+清表），返回删除条数"""
        db = get_db_sync()
        try:
            rows = db.query(LocalCommentStore).all()
            count = len(rows)
            for r in rows:
                try:
                    if os.path.exists(r.file_path):
                        os.remove(r.file_path)
                except Exception:
                    pass
                db.delete(r)
            db.commit()
            return count
        finally:
            db.close()

    def manual_cleanup(self) -> Dict[str, Any]:
        """手动触发一次 LRU 清理，返回清理前后大小"""
        db = get_db_sync()
        try:
            before = db.query(
                func.coalesce(func.sum(LocalCommentStore.size_bytes), 0)
            ).scalar() or 0
            self._enforce_limit(db)
            after = db.query(
                func.coalesce(func.sum(LocalCommentStore.size_bytes), 0)
            ).scalar() or 0
            return {"before": int(before), "after": int(after),
                    "freed": int(before) - int(after)}
        finally:
            db.close()


comment_store_service = CommentStoreService()
