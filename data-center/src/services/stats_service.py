"""
统计分析服务
"""
import logging
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import func, desc

from src.database import get_db_sync
from src.models.stats import RequestStats, IPViolationStats, UAUsageStats
from src.models.logs import SystemLog, TelegramLog, SyncLog
from src.models.config import UAConfig, IPBlacklist

logger = logging.getLogger(__name__)

class StatsService:
    """统计分析服务类"""
    
    def __init__(self):
        self.db = get_db_sync
    
    async def get_system_overview(self) -> Dict[str, Any]:
        """获取系统概览统计"""
        try:
            db = self.db()
            
            # 请求统计
            total_requests = db.query(func.sum(RequestStats.total_requests)).scalar() or 0
            successful_requests = db.query(func.sum(RequestStats.successful_requests)).scalar() or 0
            blocked_requests = db.query(func.sum(RequestStats.blocked_requests)).scalar() or 0
            error_requests = db.query(func.sum(RequestStats.error_requests)).scalar() or 0
            
            # 配置统计
            ua_configs = db.query(func.count(UAConfig.id)).scalar() or 0
            enabled_ua_configs = db.query(func.count(UAConfig.id)).filter(UAConfig.enabled == True).scalar() or 0
            blacklist_count = db.query(func.count(IPBlacklist.id)).filter(IPBlacklist.enabled == True).scalar() or 0
            
            # 违规统计
            violation_ips = db.query(func.count(func.distinct(IPViolationStats.ip_address))).scalar() or 0
            temp_banned = db.query(func.count(IPViolationStats.id)).filter(
                IPViolationStats.is_banned == "temp"
            ).scalar() or 0
            
            db.close()
            
            return {
                "total_requests": total_requests,
                "successful_requests": successful_requests,
                "blocked_requests": blocked_requests,
                "error_requests": error_requests,
                "success_rate": (successful_requests / total_requests * 100) if total_requests > 0 else 0,
                "ua_configs": ua_configs,
                "enabled_ua_configs": enabled_ua_configs,
                "blacklist_count": blacklist_count,
                "violation_ips": violation_ips,
                "temp_banned": temp_banned
            }
            
        except Exception as e:
            logger.error(f"获取系统概览失败: {e}")
            return {}
    
    async def get_recent_logs(self, limit: int = 50) -> List[SystemLog]:
        """获取最近的系统日志"""
        try:
            db = self.db()
            logs = db.query(SystemLog).order_by(desc(SystemLog.created_at)).limit(limit).all()
            db.close()
            return logs
        except Exception as e:
            logger.error(f"获取系统日志失败: {e}")
            return []
    
    async def get_logs_by_level(self, level: str, limit: int = 50) -> List[SystemLog]:
        """根据级别获取日志"""
        try:
            db = self.db()
            logs = db.query(SystemLog).filter(
                SystemLog.level == level
            ).order_by(desc(SystemLog.created_at)).limit(limit).all()
            db.close()
            return logs
        except Exception as e:
            logger.error(f"获取{level}级别日志失败: {e}")
            return []
    
    async def get_request_stats_by_hour(self, hours: int = 24) -> List[RequestStats]:
        """获取按小时的请求统计"""
        try:
            db = self.db()
            start_time = datetime.now() - timedelta(hours=hours)
            
            stats = db.query(RequestStats).filter(
                RequestStats.date_hour >= start_time
            ).order_by(RequestStats.date_hour).all()
            
            db.close()
            return stats
        except Exception as e:
            logger.error(f"获取请求统计失败: {e}")
            return []
    
    async def get_top_violation_ips(self, limit: int = 10) -> List[Dict[str, Any]]:
        """获取违规次数最多的IP"""
        try:
            db = self.db()
            
            results = db.query(
                IPViolationStats.ip_address,
                func.sum(IPViolationStats.violation_count).label('total_violations'),
                func.max(IPViolationStats.is_banned).label('ban_status')
            ).group_by(
                IPViolationStats.ip_address
            ).order_by(
                desc('total_violations')
            ).limit(limit).all()
            
            db.close()
            
            return [
                {
                    "ip_address": result.ip_address,
                    "total_violations": result.total_violations,
                    "ban_status": result.ban_status
                }
                for result in results
            ]
            
        except Exception as e:
            logger.error(f"获取违规IP统计失败: {e}")
            return []
    
    async def get_ua_usage_stats(self, hours: int = 24) -> List[Dict[str, Any]]:
        """获取UA使用统计"""
        try:
            db = self.db()
            start_time = datetime.now() - timedelta(hours=hours)
            
            results = db.query(
                UAUsageStats.ua_config_name,
                func.sum(UAUsageStats.request_count).label('total_requests'),
                func.sum(UAUsageStats.blocked_count).label('total_blocked'),
                func.avg(UAUsageStats.success_rate).label('avg_success_rate')
            ).filter(
                UAUsageStats.date_hour >= start_time
            ).group_by(
                UAUsageStats.ua_config_name
            ).order_by(
                desc('total_requests')
            ).all()
            
            db.close()
            
            return [
                {
                    "ua_config_name": result.ua_config_name,
                    "total_requests": result.total_requests or 0,
                    "total_blocked": result.total_blocked or 0,
                    "avg_success_rate": round(result.avg_success_rate or 0, 2)
                }
                for result in results
            ]
            
        except Exception as e:
            logger.error(f"获取UA使用统计失败: {e}")
            return []
    
    async def record_worker_stats(self, worker_id: str, stats_data: Dict[str, Any]) -> bool:
        """记录Worker统计数据"""
        try:
            db = self.db()
            
            # 获取当前小时
            current_hour = datetime.now().replace(minute=0, second=0, microsecond=0)
            
            # 查找或创建统计记录
            stats = db.query(RequestStats).filter(
                RequestStats.worker_id == worker_id,
                RequestStats.date_hour == current_hour
            ).first()
            
            if not stats:
                stats = RequestStats(
                    worker_id=worker_id,
                    date_hour=current_hour
                )
                db.add(stats)
            
            # 更新统计数据
            for key, value in stats_data.items():
                if hasattr(stats, key):
                    setattr(stats, key, value)
            
            db.commit()
            db.close()
            
            logger.info(f"记录Worker统计数据成功: {worker_id}")
            return True
            
        except Exception as e:
            logger.error(f"记录Worker统计数据失败: {e}")
            return False
    
    async def record_system_log(self, level: str, message: str, details: Dict = None,
                               category: str = None, source: str = None, source_ip: str = None) -> bool:
        """记录系统日志"""
        try:
            db = self.db()

            # 如果提供了source_ip，添加到details中
            if source_ip:
                if details is None:
                    details = {}
                details['source_ip'] = source_ip

            log = SystemLog(
                level=level.upper(),
                message=message,
                details=details or {},
                category=category,
                source=source or "data-center"
            )

            db.add(log)
            db.commit()
            db.close()

            return True

        except Exception as e:
            logger.error(f"记录系统日志失败: {e}")
            return False
    
    async def get_telegram_logs(self, limit: int = 50) -> List[TelegramLog]:
        """获取Telegram机器人日志"""
        try:
            db = self.db()
            logs = db.query(TelegramLog).order_by(desc(TelegramLog.created_at)).limit(limit).all()
            db.close()
            return logs
        except Exception as e:
            logger.error(f"获取TG机器人日志失败: {e}")
            return []
    
    async def get_sync_logs(self, limit: int = 50) -> List[SyncLog]:
        """获取同步日志"""
        try:
            db = self.db()
            logs = db.query(SyncLog).order_by(desc(SyncLog.created_at)).limit(limit).all()
            db.close()
            return logs
        except Exception as e:
            logger.error(f"获取同步日志失败: {e}")
            return []
    
    async def cleanup_old_data(self, days: int = 30) -> bool:
        """清理旧数据"""
        try:
            db = self.db()
            cutoff_date = datetime.now() - timedelta(days=days)
            
            # 清理旧的统计数据
            db.query(RequestStats).filter(RequestStats.created_at < cutoff_date).delete()
            db.query(IPViolationStats).filter(IPViolationStats.created_at < cutoff_date).delete()
            db.query(UAUsageStats).filter(UAUsageStats.created_at < cutoff_date).delete()
            
            # 清理旧的日志数据
            db.query(SystemLog).filter(SystemLog.created_at < cutoff_date).delete()
            db.query(TelegramLog).filter(TelegramLog.created_at < cutoff_date).delete()
            db.query(SyncLog).filter(SyncLog.created_at < cutoff_date).delete()
            
            db.commit()
            db.close()
            
            logger.info(f"清理{days}天前的旧数据成功")
            return True
            
        except Exception as e:
            logger.error(f"清理旧数据失败: {e}")
            return False
    
    async def get_performance_metrics(self) -> Dict[str, Any]:
        """获取性能指标"""
        try:
            db = self.db()
            
            # 最近24小时的平均响应时间
            avg_response_time = db.query(func.avg(RequestStats.avg_response_time)).filter(
                RequestStats.date_hour >= datetime.now() - timedelta(hours=24)
            ).scalar() or 0
            
            # 最近1小时的请求量
            recent_requests = db.query(func.sum(RequestStats.total_requests)).filter(
                RequestStats.date_hour >= datetime.now() - timedelta(hours=1)
            ).scalar() or 0
            
            # 错误率
            recent_errors = db.query(func.sum(RequestStats.error_requests)).filter(
                RequestStats.date_hour >= datetime.now() - timedelta(hours=24)
            ).scalar() or 0
            
            recent_total = db.query(func.sum(RequestStats.total_requests)).filter(
                RequestStats.date_hour >= datetime.now() - timedelta(hours=24)
            ).scalar() or 0
            
            error_rate = (recent_errors / recent_total * 100) if recent_total > 0 else 0
            
            db.close()
            
            return {
                "avg_response_time": round(avg_response_time, 2),
                "recent_requests_per_hour": recent_requests,
                "error_rate_24h": round(error_rate, 2),
                "timestamp": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"获取性能指标失败: {e}")
            return {}

    async def get_summary(self) -> Dict[str, Any]:
        """获取统计数据摘要"""
        try:
            db = self.db()

            # 今日请求数
            today = datetime.now().date()
            today_requests = db.query(func.sum(RequestStats.total_requests)).filter(
                func.date(RequestStats.created_at) == today
            ).scalar() or 0

            # 总请求数
            total_requests = db.query(func.sum(RequestStats.total_requests)).scalar() or 0

            # 成功率
            successful_requests = db.query(func.sum(RequestStats.successful_requests)).scalar() or 0
            success_rate = round((successful_requests / total_requests * 100) if total_requests > 0 else 0, 1)

            # Worker状态 (模拟数据，实际应该从Worker API获取)
            online_workers = 0
            total_workers = 0

            # 平均响应时间
            avg_response_time = db.query(func.avg(RequestStats.avg_response_time)).scalar() or 0
            avg_response_time = round(avg_response_time, 2)

            # 被阻止的IP数量
            blocked_ips = db.query(func.count(IPBlacklist.id)).scalar() or 0

            # 今日阻止的请求数
            today_blocked = db.query(func.sum(IPViolationStats.violation_count)).filter(
                func.date(IPViolationStats.created_at) == today
            ).scalar() or 0

            # 违规请求数
            violation_requests = db.query(func.sum(IPViolationStats.violation_count)).scalar() or 0

            # 系统运行时间 (简单计算)
            import psutil
            uptime_seconds = psutil.boot_time()
            current_time = datetime.now().timestamp()
            uptime_minutes = int((current_time - uptime_seconds) / 60)

            if uptime_minutes < 60:
                uptime = f"{uptime_minutes}分钟"
            elif uptime_minutes < 1440:
                uptime = f"{uptime_minutes // 60}小时{uptime_minutes % 60}分钟"
            else:
                days = uptime_minutes // 1440
                hours = (uptime_minutes % 1440) // 60
                uptime = f"{days}天{hours}小时"

            return {
                "today_requests": today_requests,
                "total_requests": total_requests,
                "success_rate": success_rate,
                "online_workers": online_workers,
                "total_workers": total_workers,
                "avg_response_time": avg_response_time,
                "blocked_ips": blocked_ips,
                "today_blocked": today_blocked,
                "violation_requests": violation_requests,
                "memory_usage": 0,  # 可以用psutil获取
                "cpu_usage": 0,     # 可以用psutil获取
                "uptime": uptime
            }

        except Exception as e:
            logger.error(f"获取统计摘要失败: {e}")
            return {
                "today_requests": 0,
                "total_requests": 0,
                "success_rate": 0,
                "online_workers": 0,
                "total_workers": 0,
                "avg_response_time": 0,
                "blocked_ips": 0,
                "today_blocked": 0,
                "violation_requests": 0,
                "memory_usage": 0,
                "cpu_usage": 0,
                "uptime": "0分钟"
            }
