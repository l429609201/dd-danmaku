"""
系统统计服务 - 获取数据中心的真实系统指标
"""
import psutil
import logging
from datetime import datetime
from typing import Dict, Any
from src.database import get_db_session

logger = logging.getLogger(__name__)

class SystemStatsService:
    """系统统计服务"""
    
    def __init__(self):
        self.start_time = datetime.now()
    
    async def get_system_stats(self) -> Dict[str, Any]:
        """获取系统统计数据"""
        try:
            # CPU统计
            cpu_percent = psutil.cpu_percent(interval=1)
            cpu_count = psutil.cpu_count()
            cpu_freq = psutil.cpu_freq()
            
            # 内存统计
            memory = psutil.virtual_memory()
            swap = psutil.swap_memory()
            
            # 磁盘统计
            disk = psutil.disk_usage('/')
            
            # 网络统计
            network = psutil.net_io_counters()
            
            # 进程统计
            process = psutil.Process()
            process_memory = process.memory_info()
            process_cpu = process.cpu_percent()
            
            # 数据库统计
            db_stats = await self._get_database_stats()
            
            return {
                "timestamp": datetime.now().isoformat(),
                "uptime_seconds": (datetime.now() - self.start_time).total_seconds(),
                
                # CPU信息
                "cpu": {
                    "usage_percent": cpu_percent,
                    "core_count": cpu_count,
                    "frequency_mhz": cpu_freq.current if cpu_freq else 0
                },
                
                # 内存信息
                "memory": {
                    "total_mb": round(memory.total / 1024 / 1024),
                    "used_mb": round(memory.used / 1024 / 1024),
                    "available_mb": round(memory.available / 1024 / 1024),
                    "usage_percent": memory.percent,
                    "swap_total_mb": round(swap.total / 1024 / 1024),
                    "swap_used_mb": round(swap.used / 1024 / 1024),
                    "swap_percent": swap.percent
                },
                
                # 磁盘信息
                "disk": {
                    "total_gb": round(disk.total / 1024 / 1024 / 1024, 2),
                    "used_gb": round(disk.used / 1024 / 1024 / 1024, 2),
                    "free_gb": round(disk.free / 1024 / 1024 / 1024, 2),
                    "usage_percent": round((disk.used / disk.total) * 100, 2)
                },
                
                # 网络信息
                "network": {
                    "bytes_sent": network.bytes_sent,
                    "bytes_recv": network.bytes_recv,
                    "packets_sent": network.packets_sent,
                    "packets_recv": network.packets_recv
                },
                
                # 进程信息
                "process": {
                    "cpu_percent": process_cpu,
                    "memory_mb": round(process_memory.rss / 1024 / 1024),
                    "memory_percent": process.memory_percent(),
                    "threads": process.num_threads(),
                    "connections": len(process.connections())
                },
                
                # 数据库统计
                "database": db_stats
            }
            
        except Exception as e:
            logger.error(f"获取系统统计失败: {e}")
            return {
                "timestamp": datetime.now().isoformat(),
                "error": str(e),
                "uptime_seconds": (datetime.now() - self.start_time).total_seconds()
            }
    
    async def _get_database_stats(self) -> Dict[str, Any]:
        """获取数据库统计"""
        try:
            async with get_db_session() as session:
                # 这里可以添加数据库特定的统计查询
                # 例如：表行数、连接数等
                return {
                    "status": "connected",
                    "connection_pool_size": 10,  # 根据实际配置
                    "active_connections": 1
                }
        except Exception as e:
            logger.error(f"获取数据库统计失败: {e}")
            return {
                "status": "error",
                "error": str(e)
            }

# 全局实例
_system_stats_service = None

def get_system_stats_service() -> SystemStatsService:
    """获取系统统计服务实例"""
    global _system_stats_service
    if _system_stats_service is None:
        _system_stats_service = SystemStatsService()
    return _system_stats_service
