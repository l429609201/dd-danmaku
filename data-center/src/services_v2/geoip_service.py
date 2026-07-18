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
from src.models_v2.base import now

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

    def aggregate_points(self, limit_ips: int = 200000,
                         top_points: int = 500) -> Dict[str, Any]:
        """解析 Top IP 聚合为散点：按经纬度网格合并请求量。

        解析结果持久化到 ip_geo_cache 表：已解析的 IP（含解析失败的）直接读表，
        只对未入表的「新 IP」做 GeoLite2 lookup 并写回，避免每次全量重算。

        返回 { available, points:[{name,value:[lng,lat,count]}], total_ips, resolved }
        """
        self._ensure_reader()
        if not self._available:
            return {"available": False, "points": [], "total_ips": 0, "resolved": 0}

        from src.models_v2 import IpGeoCache
        db = get_db_sync()
        try:
            # 按总请求量取 Top IP（合并同 IP 多 worker 的计数）
            rows = db.query(
                IpRequestStatCurrent.ip,
                func.sum(IpRequestStatCurrent.total_count).label("cnt"),
            ).group_by(IpRequestStatCurrent.ip) \
             .order_by(func.sum(IpRequestStatCurrent.total_count).desc()) \
             .limit(limit_ips).all()

            ip_counts = {str(ip): int(cnt or 0) for ip, cnt in rows}
            if not ip_counts:
                return {"available": True, "points": [], "total_ips": 0, "resolved": 0}

            # 1. 读已缓存的解析结果（含失败记录，避免重复 lookup）
            cached = {c.ip: c for c in db.query(IpGeoCache).filter(
                IpGeoCache.ip.in_(list(ip_counts.keys()))).all()}

            # 2. 对未缓存的新 IP 解析并写回表（增量）
            new_count = 0
            for ip in ip_counts:
                if ip in cached:
                    continue
                geo = self._lookup(ip)
                rec = IpGeoCache(
                    ip=ip,
                    lng=str(geo["lng"]) if geo else None,
                    lat=str(geo["lat"]) if geo else None,
                    city=geo["city"] if geo else None,
                    country=geo["country"] if geo else None,
                    resolved=bool(geo),
                    resolved_at=now(),
                )
                db.merge(rec)
                cached[ip] = rec
                new_count += 1
            if new_count:
                db.commit()
                logger.info(f"🌍 IP 地理解析增量 {new_count} 个新 IP（总 {len(ip_counts)}）")
        finally:
            db.close()

        # 3. 按坐标聚合（只用解析成功的）
        agg: Dict[tuple, Dict[str, Any]] = {}
        resolved = 0
        for ip, cnt in ip_counts.items():
            c = cached.get(ip)
            if not c or not c.resolved or c.lng is None or c.lat is None:
                continue
            resolved += 1
            try:
                lng, lat = float(c.lng), float(c.lat)
            except (TypeError, ValueError):
                continue
            key = (lng, lat)
            if key not in agg:
                agg[key] = {"name": c.city or "未知", "country": c.country or "",
                            "lng": lng, "lat": lat, "count": 0}
            agg[key]["count"] += cnt

        points = sorted(agg.values(), key=lambda x: x["count"], reverse=True)[:top_points]
        return {
            "available": True,
            "points": [{
                "name": p["name"], "country": p["country"],
                "value": [p["lng"], p["lat"], p["count"]],
            } for p in points],
            "total_ips": len(ip_counts),
            "resolved": resolved,
        }


geoip_service = GeoIpService()
