"""
任务调度器
"""
import asyncio
import logging
from datetime import datetime
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from src.config import settings
from src.services.stats_service import StatsService
from src.services.config_service import ConfigService
from src.services.worker_sync import WorkerSyncService

logger = logging.getLogger(__name__)

class TaskScheduler:
    """任务调度器类"""
    
    def __init__(self):
        self.scheduler = AsyncIOScheduler()
        self.stats_service = StatsService()
        self.config_service = ConfigService()
        self.worker_sync = WorkerSyncService()
        
        # 配置调度器
        self.scheduler.configure(
            timezone='Asia/Shanghai',
            job_defaults={
                'coalesce': True,
                'max_instances': 1,
                'misfire_grace_time': 300  # 5分钟容错时间
            }
        )
    
    async def start(self):
        """启动调度器"""
        try:
            logger.info("🕐 启动任务调度器...")
            
            # 添加定时任务
            await self._add_scheduled_jobs()
            
            # 启动调度器
            self.scheduler.start()
            
            logger.info("✅ 任务调度器启动成功")
            
        except Exception as e:
            logger.error(f"❌ 任务调度器启动失败: {e}")
            raise
    
    async def stop(self):
        """停止调度器"""
        try:
            logger.info("🛑 停止任务调度器...")
            self.scheduler.shutdown(wait=True)
            logger.info("✅ 任务调度器已停止")
        except Exception as e:
            logger.error(f"❌ 停止任务调度器失败: {e}")
    
    async def _add_scheduled_jobs(self):
        """添加定时任务"""
        
        # 1. 数据清理任务 - 每天凌晨2点执行
        self.scheduler.add_job(
            self._cleanup_old_data,
            trigger=CronTrigger(hour=2, minute=0),
            id='cleanup_old_data',
            name='清理旧数据',
            replace_existing=True
        )
        
        # 2. 配置同步任务 - 每小时执行
        self.scheduler.add_job(
            self._sync_config_to_workers,
            trigger=IntervalTrigger(hours=settings.SYNC_INTERVAL_HOURS),
            id='sync_config_to_workers',
            name='同步配置到Worker',
            replace_existing=True
        )
        
        # 3. 健康检查任务 - 每5分钟执行
        self.scheduler.add_job(
            self._health_check,
            trigger=IntervalTrigger(minutes=5),
            id='health_check',
            name='系统健康检查',
            replace_existing=True
        )
        
        # 4. 统计数据汇总任务 - 每小时执行
        self.scheduler.add_job(
            self._aggregate_stats,
            trigger=CronTrigger(minute=5),  # 每小时的第5分钟执行
            id='aggregate_stats',
            name='统计数据汇总',
            replace_existing=True
        )
        
        # 5. 系统状态记录任务 - 每10分钟执行
        self.scheduler.add_job(
            self._record_system_status,
            trigger=IntervalTrigger(minutes=10),
            id='record_system_status',
            name='记录系统状态',
            replace_existing=True
        )
        
        logger.info("📋 已添加 5 个定时任务")
    
    async def _cleanup_old_data(self):
        """清理旧数据任务"""
        try:
            logger.info("🧹 开始清理旧数据...")
            
            success = await self.stats_service.cleanup_old_data(days=30)
            
            if success:
                logger.info("✅ 旧数据清理完成")
                await self.stats_service.record_system_log(
                    "INFO", "定时清理旧数据完成", 
                    category="maintenance", source="scheduler"
                )
            else:
                logger.error("❌ 旧数据清理失败")
                await self.stats_service.record_system_log(
                    "ERROR", "定时清理旧数据失败", 
                    category="maintenance", source="scheduler"
                )
                
        except Exception as e:
            logger.error(f"❌ 清理旧数据任务异常: {e}")
            await self.stats_service.record_system_log(
                "ERROR", f"清理旧数据任务异常: {str(e)}", 
                category="maintenance", source="scheduler"
            )
    
    async def _sync_config_to_workers(self):
        """同步配置到Worker任务"""
        try:
            logger.info("🔄 开始同步配置到Worker...")
            
            # 获取所有Worker端点
            worker_endpoints = settings.WORKER_ENDPOINTS
            
            if not worker_endpoints:
                logger.warning("⚠️ 未配置Worker端点，跳过同步")
                return
            
            # 导出当前配置
            config_data = await self.config_service.export_config_for_worker()
            
            # 同步到每个Worker
            success_count = 0
            for endpoint in worker_endpoints:
                try:
                    result = await self.worker_sync.push_config_to_worker(endpoint, config_data)
                    if result:
                        success_count += 1
                        logger.info(f"✅ 配置同步到 {endpoint} 成功")
                    else:
                        logger.error(f"❌ 配置同步到 {endpoint} 失败")
                except Exception as e:
                    logger.error(f"❌ 同步到 {endpoint} 异常: {e}")
            
            # 记录同步结果
            await self.stats_service.record_system_log(
                "INFO", f"配置同步完成: {success_count}/{len(worker_endpoints)} 成功", 
                details={"success_count": success_count, "total_workers": len(worker_endpoints)},
                category="sync", source="scheduler"
            )
            
        except Exception as e:
            logger.error(f"❌ 配置同步任务异常: {e}")
            await self.stats_service.record_system_log(
                "ERROR", f"配置同步任务异常: {str(e)}", 
                category="sync", source="scheduler"
            )
    
    async def _health_check(self):
        """健康检查任务"""
        try:
            logger.debug("🔍 执行系统健康检查...")
            
            # 检查数据库连接
            from src.database import check_db_health
            db_healthy = check_db_health()
            
            # 获取系统概览
            system_stats = await self.stats_service.get_system_overview()
            
            # 获取性能指标
            performance = await self.stats_service.get_performance_metrics()
            
            # 记录健康状态
            health_status = {
                "database": "healthy" if db_healthy else "unhealthy",
                "system_stats": system_stats,
                "performance": performance,
                "timestamp": datetime.now().isoformat()
            }
            
            # 如果有异常情况，记录警告日志
            if not db_healthy:
                await self.stats_service.record_system_log(
                    "WARN", "数据库连接异常", 
                    details=health_status,
                    category="health", source="scheduler"
                )
            
            # 检查错误率
            error_rate = performance.get("error_rate_24h", 0)
            if error_rate > 5:  # 错误率超过5%
                await self.stats_service.record_system_log(
                    "WARN", f"系统错误率过高: {error_rate}%", 
                    details=health_status,
                    category="health", source="scheduler"
                )
            
        except Exception as e:
            logger.error(f"❌ 健康检查任务异常: {e}")
            await self.stats_service.record_system_log(
                "ERROR", f"健康检查任务异常: {str(e)}", 
                category="health", source="scheduler"
            )
    
    async def _aggregate_stats(self):
        """统计数据汇总任务"""
        try:
            logger.debug("📊 执行统计数据汇总...")
            
            # 获取系统概览统计
            overview = await self.stats_service.get_system_overview()
            
            # 记录汇总统计
            await self.stats_service.record_system_log(
                "INFO", "统计数据汇总完成", 
                details=overview,
                category="stats", source="scheduler"
            )
            
        except Exception as e:
            logger.error(f"❌ 统计汇总任务异常: {e}")
            await self.stats_service.record_system_log(
                "ERROR", f"统计汇总任务异常: {str(e)}", 
                category="stats", source="scheduler"
            )
    
    async def _record_system_status(self):
        """记录系统状态任务"""
        try:
            logger.debug("📝 记录系统状态...")
            
            # 获取系统状态
            status = await self.stats_service.get_system_overview()
            performance = await self.stats_service.get_performance_metrics()
            
            # 合并状态信息
            system_status = {
                **status,
                **performance,
                "timestamp": datetime.now().isoformat()
            }
            
            # 记录状态日志
            await self.stats_service.record_system_log(
                "INFO", "系统状态记录", 
                details=system_status,
                category="status", source="scheduler"
            )
            
        except Exception as e:
            logger.error(f"❌ 系统状态记录任务异常: {e}")
    
    def get_job_status(self) -> dict:
        """获取任务状态"""
        try:
            jobs = []
            for job in self.scheduler.get_jobs():
                jobs.append({
                    "id": job.id,
                    "name": job.name,
                    "next_run": job.next_run_time.isoformat() if job.next_run_time else None,
                    "trigger": str(job.trigger)
                })
            
            return {
                "scheduler_running": self.scheduler.running,
                "jobs": jobs,
                "total_jobs": len(jobs)
            }
            
        except Exception as e:
            logger.error(f"获取任务状态失败: {e}")
            return {"error": str(e)}
