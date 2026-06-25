"""
IP 地理定位服务（请求地图城市级散点）

复用 ip_request_stats_current 表的明文 IP，用 MaxMind GeoLite2-City 离线库
解析为经纬度/城市，聚合成 ECharts 散点数据。

库文件需自行下载放到 GEOIP_DB_PATH（默认 /app/config/GeoLite2-City.mmdb）。
库不存在时返回 available=False，前端优雅降级。
"""
import logging
import os
from typing import Any, Dict, List, Optional

from sqlalchemy import func

from src.database import get_db_sync
from src.models_v2 import IpRequestStatCurrent

logger = logging.getLogger(__name__)

GEOIP_DB_PATH = os.getenv("GEOIP_DB_PATH", "/app/config/GeoLite2-City.mmdb")


class GeoIpService:
    """GeoLite2 IP 定位（懒加载 reader，库不存在则降级）"""

    def __init__(self):
        self._reader = None
        self._loaded = False
        self._available = False

    def _ensure_reader(self):
        """懒加载 mmdb reader，只尝试一次"""
        if self._loaded:
            return
        self._loaded = True
        if not os.path.exists(GEOIP_DB_PATH):
            logger.warning(f"⚠️ GeoLite2 库不存在: {GEOIP_DB_PATH}，请求地图降级")
            return
        try:
            import geoip2.database
            self._reader = geoip2.database.Reader(GEOIP_DB_PATH)
            self._available = True
            logger.info(f"✅ GeoLite2 库已加载: {GEOIP_DB_PATH}")
        except Exception as e:
            logger.error(f"❌ GeoLite2 库加载失败: {e}")

    def _lookup(self, ip: str) -> Optional[Dict[str, Any]]:
        """解析单个 IP，返回经纬度/城市/国家；失败返回 None"""
        try:
            r = self._reader.city(ip)
            if r.location.longitude is None or r.location.latitude is None:
                return None
            return {
                "lng": round(r.location.longitude, 4),
                "lat": round(r.location.latitude, 4),
                "city": (r.city.name or r.subdivisions.most_specific.name
                         or r.country.name or "未知"),
                "country": r.country.iso_code or "",
            }
        except Exception:
            # 私有 IP / 未收录 / 解析异常都跳过
            return None

    def aggregate_points(self, limit_ips: int = 5000,
                         top_points: int = 500) -> Dict[str, Any]:
        """解析 Top IP 聚合为散点：按 经纬度 网格合并请求量

        返回 { available, points: [{name,value:[lng,lat,count]}], total_ips, resolved }
        """
        self._ensure_reader()
        if not self._available:
            return {"available": False, "points": [], "total_ips": 0, "resolved": 0}

        db = get_db_sync()
        try:
            # 按总请求量取 Top IP（合并同 IP 多 worker 的计数）
            rows = db.query(
                IpRequestStatCurrent.ip,
                func.sum(IpRequestStatCurrent.total_count).label("cnt"),
            ).group_by(IpRequestStatCurrent.ip) \
             .order_by(func.sum(IpRequestStatCurrent.total_count).desc()) \
             .limit(limit_ips).all()
        finally:
            db.close()

        # 按坐标聚合（同城市/同坐标合并）
        agg: Dict[tuple, Dict[str, Any]] = {}
        resolved = 0
        for ip, cnt in rows:
            geo = self._lookup(str(ip))
            if not geo:
                continue
            resolved += 1
            key = (geo["lng"], geo["lat"])
            if key not in agg:
                agg[key] = {"name": geo["city"], "country": geo["country"],
                            "lng": geo["lng"], "lat": geo["lat"], "count": 0}
            agg[key]["count"] += int(cnt or 0)

        points = sorted(agg.values(), key=lambda x: x["count"], reverse=True)[:top_points]
        return {
            "available": True,
            "points": [{
                "name": p["name"], "country": p["country"],
                "value": [p["lng"], p["lat"], p["count"]],
            } for p in points],
            "total_ips": len(rows),
            "resolved": resolved,
        }


geoip_service = GeoIpService()
