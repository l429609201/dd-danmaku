"""
Worker 日志按日聚合计数服务

明细日志已迁到轮转 JSONL 文件，但仪表盘的「运维洞察」需要聚合统计
（缓存来源分布 / 各接口 429 分布 / UA Top / 级别分布）。

不扫文件、不存明细：日志进来时在内存按「日期+维度」累加计数，
每 FLUSH_INTERVAL 秒把增量 upsert 到 worker_log_daily_stats。
一天只产生几十行，与请求量无关。

口径为「当日」（本地时区 0 点起），跨天自动切到新的 stat_date。
"""
import asyncio
import logging
from collections import defaultdict
from typing import Any, Dict, List, Optional

from sqlalchemy import text as sql_text

from src.database import get_db_sync
from src.models_v2 import WorkerLogDailyStat
from src.models_v2.base import now

logger = logging.getLogger(__name__)

# 增量落库间隔（秒）：日志是高频写入，攒批降低 DB 压力
FLUSH_INTERVAL = 30.0

# 各接口 429 分布用的路径前缀归一表（与原 dashboard 聚合口径保持一致）
API_GROUPS = {
    "search_anime": "/api/v2/search/anime",
    "search_episodes": "/api/v2/search/episodes",
    "bangumi": "/api/v2/bangumi/",
    "comment": "/api/v2/comment/",
    "match": "/api/v2/match",
}


class WorkerLogStatsService:
    """按日聚合计数：内存累加 + 周期 upsert"""

    def __init__(self):
        # {(stat_date, dim_type, dim_value): 增量计数}
        self._pending: Dict[tuple, int] = defaultdict(int)
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._flushed = 0

    async def start(self):
        self._running = True
        self._task = asyncio.create_task(self._flush_loop())
        logger.info("📊 Worker 日志聚合统计已启动")

    async def stop(self):
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        # 退出前把剩余增量落库，避免丢当日统计
        try:
            await asyncio.to_thread(self._flush_once)
        except Exception:
            pass

    def stats(self) -> dict:
        return {"pending_dims": len(self._pending), "flushed": self._flushed}

    # ---------- 累加 ----------
    def record(self, rows: List[Dict[str, Any]]):
        """按维度累加一批日志的计数（纯内存，无 IO）"""
        if not rows:
            return
        for row in rows:
            date = self._date_of(row)
            # 缓存来源分布
            src = row.get("cache_source")
            if src:
                self._pending[(date, "cache_source", str(src)[:200])] += 1
            # UA 分布
            ua = row.get("ua_type")
            if ua:
                self._pending[(date, "ua_type", str(ua)[:200])] += 1
            # 级别分布
            lv = row.get("level")
            if lv:
                self._pending[(date, "level", str(lv)[:200])] += 1
            # 各接口 429：与原 SQL 口径一致（upstream_status == 429）
            if row.get("upstream_status") == 429:
                grp = self._api_group(row.get("path"))
                if grp:
                    self._pending[(date, "api_429", grp)] += 1

    @staticmethod
    def _date_of(row: Dict[str, Any]) -> str:
        """取日志所属日期；created_at 缺失或异常时归到今天"""
        raw = row.get("created_at")
        if isinstance(raw, str) and len(raw) >= 10:
            return raw[:10]
        return now().strftime("%Y-%m-%d")

    @staticmethod
    def _api_group(path: Optional[str]) -> Optional[str]:
        """按前缀把路径归一到接口组"""
        if not path:
            return None
        for key, prefix in API_GROUPS.items():
            if str(path).startswith(prefix):
                return key
        return None

    # ---------- 落库 ----------
    async def _flush_loop(self):
        while self._running:
            try:
                await asyncio.sleep(FLUSH_INTERVAL)
            except asyncio.CancelledError:
                break
            if self._pending:
                await asyncio.to_thread(self._flush_once)

    def _flush_once(self):
        """把内存增量 upsert 到聚合表（增量累加而非覆盖）"""
        if not self._pending:
            return
        # 抽干当前增量，后续新增进入下一轮
        batch, self._pending = dict(self._pending), defaultdict(int)
        db = get_db_sync()
        try:
            dialect = db.bind.dialect.name
            for (date, dim_type, dim_value), delta in batch.items():
                if delta <= 0:
                    continue
                self._upsert(db, dialect, date, dim_type, dim_value, delta)
            db.commit()
            self._flushed += len(batch)
        except Exception as e:
            db.rollback()
            # 落库失败把增量还回内存，下轮重试，避免丢统计
            for k, v in batch.items():
                self._pending[k] += v
            logger.warning(f"⚠️ Worker 日志聚合落库失败（下轮重试）: {e}")
        finally:
            db.close()

    @staticmethod
    def _upsert(db, dialect: str, date: str, dim_type: str,
                dim_value: str, delta: int):
        """按方言做「插入或累加」；避免先查后写的并发覆盖"""
        if dialect == "mysql":
            db.execute(sql_text(
                "INSERT INTO worker_log_daily_stats "
                "(stat_date, dim_type, dim_value, count, updated_at) "
                "VALUES (:d, :t, :v, :c, NOW()) "
                "ON DUPLICATE KEY UPDATE count = count + :c, updated_at = NOW()"
            ), {"d": date, "t": dim_type, "v": dim_value, "c": delta})
        elif dialect == "postgresql":
            db.execute(sql_text(
                "INSERT INTO worker_log_daily_stats "
                "(stat_date, dim_type, dim_value, count, updated_at) "
                "VALUES (:d, :t, :v, :c, NOW()) "
                "ON CONFLICT (stat_date, dim_type, dim_value) "
                "DO UPDATE SET count = worker_log_daily_stats.count + :c, "
                "updated_at = NOW()"
            ), {"d": date, "t": dim_type, "v": dim_value, "c": delta})
        else:  # sqlite: 不支持 ON CONFLICT，先查后写
            row = db.query(WorkerLogDailyStat).filter(
                WorkerLogDailyStat.stat_date == date,
                WorkerLogDailyStat.dim_type == dim_type,
                WorkerLogDailyStat.dim_value == dim_value,
            ).first()
            if row is None:
                row = WorkerLogDailyStat(
                    stat_date=date, dim_type=dim_type,
                    dim_value=dim_value, count=delta)
                db.add(row)
            else:
                row.count = (row.count or 0) + delta
                row.updated_at = now()

    # ---------- 查询 ----------
    def query_day(self, stat_date: Optional[str] = None) -> Dict[str, Any]:
        """读取某日聚合结果（默认当日），供仪表盘洞察面板使用"""
        date = stat_date or now().strftime("%Y-%m-%d")
        db = get_db_sync()
        try:
            rows = db.query(
                WorkerLogDailyStat.dim_type,
                WorkerLogDailyStat.dim_value,
                WorkerLogDailyStat.count,
            ).filter(WorkerLogDailyStat.stat_date == date).all()
        finally:
            db.close()

        grouped: Dict[str, list] = defaultdict(list)
        for dim_type, dim_value, count in rows:
            grouped[dim_type].append({"value": dim_value, "count": int(count or 0)})
        for k in grouped:
            grouped[k].sort(key=lambda x: x["count"], reverse=True)
        return {
            "stat_date": date,
            "cache_sources": [
                {"source": i["value"], "count": i["count"]}
                for i in grouped.get("cache_source", [])
            ],
            # 保持原字段名与顺序，前端无需改动
            "api_429": [
                {"api_group": k, "count": next(
                    (i["count"] for i in grouped.get("api_429", [])
                     if i["value"] == k), 0)}
                for k in API_GROUPS
            ],
            "ua_top": [
                {"ua_type": i["value"], "count": i["count"]}
                for i in grouped.get("ua_type", [])[:10]
            ],
            "levels": [
                {"level": i["value"], "count": i["count"]}
                for i in grouped.get("level", [])
            ],
        }


worker_log_stats_service = WorkerLogStatsService()
