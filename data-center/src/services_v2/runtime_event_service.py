"""
运行事件服务（RuntimeEvent）

替代旧 SystemLog / SyncLog，统一记录本地端运行事件。
"""
import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import desc

from src.database import get_db_sync
from src.models_v2 import RuntimeEvent

logger = logging.getLogger(__name__)


class RuntimeEventService:
    """运行事件服务"""

    def record(self, level: str, category: str, event: str,
               message: str, details: Optional[Dict[str, Any]] = None):
        """记录一条运行事件"""
        db = get_db_sync()
        try:
            row = RuntimeEvent(
                level=level.upper(), category=category, event=event,
                message=message, details_json=details,
            )
            db.add(row)
            db.commit()
        except Exception as e:
            db.rollback()
            logger.error(f"❌ 写入运行事件失败: {e}")
        finally:
            db.close()

    # log 为 record 的别名，便于调用方语义化使用
    def log(self, level: str, category: str, event: str,
            message: str, details: Optional[Dict[str, Any]] = None):
        self.record(level, category, event, message, details)

    def query(self, level: Optional[str] = None, category: Optional[str] = None,
              event: Optional[str] = None, limit: int = 200) -> List[Dict[str, Any]]:
        """查询运行事件（倒序）"""
        db = get_db_sync()
        try:
            q = db.query(RuntimeEvent)
            if level:
                q = q.filter(RuntimeEvent.level == level.upper())
            if category:
                q = q.filter(RuntimeEvent.category == category)
            if event:
                q = q.filter(RuntimeEvent.event == event)
            rows = q.order_by(desc(RuntimeEvent.created_at)).limit(limit).all()
            return [{
                "id": r.id,
                "level": r.level,
                "category": r.category,
                "event": r.event,
                "message": r.message,
                "details": r.details_json,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            } for r in rows]
        finally:
            db.close()


runtime_event_service = RuntimeEventService()
