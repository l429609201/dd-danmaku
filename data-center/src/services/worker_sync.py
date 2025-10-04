"""
Worker同步服务
"""
import asyncio
import logging
from typing import Dict, Any, List, Optional
import httpx
from datetime import datetime

from src.config import settings
from src.services.stats_service import StatsService
from src.models.logs import SyncLog
from src.database import get_db_sync

logger = logging.getLogger(__name__)

class WorkerSyncService:
    """Worker同步服务类"""
    
    def __init__(self):
        self.stats_service = StatsService()
        self.db = get_db_sync
        
        # HTTP客户端配置
        self.client_config = {
            "timeout": httpx.Timeout(settings.SYNC_TIMEOUT_SECONDS),
            "limits": httpx.Limits(max_connections=10, max_keepalive_connections=5)
        }
    
    async def push_config_to_worker(self, worker_endpoint: str, config_data: Dict[str, Any]) -> bool:
        """推送配置到Worker"""
        sync_log = None
        
        try:
            # 创建同步日志
            sync_log = await self._create_sync_log(
                worker_endpoint, "config", "push", len(str(config_data))
            )
            
            logger.info(f"🔄 开始推送配置到Worker: {worker_endpoint}")
            
            async with httpx.AsyncClient(**self.client_config) as client:
                # 构建推送URL
                push_url = f"{worker_endpoint.rstrip('/')}/api/config/update"
                
                # 获取API密钥
                from src.services.web_config_service import WebConfigService
                web_config_service = WebConfigService()
                settings = await web_config_service.get_system_settings()
                api_key = settings.worker_api_key if settings else None

                # 构建请求头
                headers = {
                    "Content-Type": "application/json",
                    "User-Agent": "DataCenter-Sync/1.0"
                }

                if api_key:
                    headers["X-API-Key"] = api_key

                # 发送配置数据
                response = await client.post(
                    push_url,
                    json={
                        "ua_configs": config_data.get("ua_configs", {}),
                        "ip_blacklist": config_data.get("ip_blacklist", {}),
                        "timestamp": datetime.now().isoformat()
                    },
                    headers=headers
                )
                
                if response.status_code == 200:
                    result = response.json()
                    if result.get("success"):
                        logger.info(f"✅ 配置推送成功: {worker_endpoint}")
                        await self._complete_sync_log(sync_log, "success")
                        return True
                    else:
                        error_msg = result.get("error", "Unknown error")
                        logger.error(f"❌ Worker返回错误: {error_msg}")
                        await self._complete_sync_log(sync_log, "failed", error_msg)
                        return False
                else:
                    error_msg = f"HTTP {response.status_code}: {response.text}"
                    logger.error(f"❌ 配置推送失败: {error_msg}")
                    await self._complete_sync_log(sync_log, "failed", error_msg)
                    return False
                    
        except httpx.TimeoutException:
            error_msg = f"推送配置超时: {worker_endpoint}"
            logger.error(f"❌ {error_msg}")
            if sync_log:
                await self._complete_sync_log(sync_log, "timeout", error_msg)
            return False
            
        except Exception as e:
            error_msg = f"推送配置异常: {str(e)}"
            logger.error(f"❌ {error_msg}")
            if sync_log:
                await self._complete_sync_log(sync_log, "error", error_msg)
            return False
    
    async def pull_stats_from_worker(self, worker_endpoint: str) -> Optional[Dict[str, Any]]:
        """从Worker拉取统计数据"""
        sync_log = None
        
        try:
            # 创建同步日志
            sync_log = await self._create_sync_log(
                worker_endpoint, "stats", "pull", 0
            )
            
            logger.info(f"📊 开始从Worker拉取统计: {worker_endpoint}")
            
            async with httpx.AsyncClient(**self.client_config) as client:
                # 构建拉取URL
                stats_url = f"{worker_endpoint.rstrip('/')}/api/stats/export"

                # 获取API密钥
                from src.services.web_config_service import WebConfigService
                web_config_service = WebConfigService()
                settings = await web_config_service.get_system_settings()
                api_key = settings.worker_api_key if settings else None

                # 构建请求头
                headers = {"User-Agent": "DataCenter-Sync/1.0"}
                if api_key:
                    headers["X-API-Key"] = api_key

                response = await client.get(stats_url, headers=headers)
                
                if response.status_code == 200:
                    stats_data = response.json()
                    logger.info(f"✅ 统计数据拉取成功: {worker_endpoint}")
                    
                    # 更新同步日志
                    data_size = len(response.content)
                    records_count = len(stats_data.get("request_stats", []))
                    await self._complete_sync_log(sync_log, "success", data_size=data_size, records_count=records_count)
                    
                    return stats_data
                else:
                    error_msg = f"HTTP {response.status_code}: {response.text}"
                    logger.error(f"❌ 统计拉取失败: {error_msg}")
                    await self._complete_sync_log(sync_log, "failed", error_msg)
                    return None
                    
        except httpx.TimeoutException:
            error_msg = f"拉取统计超时: {worker_endpoint}"
            logger.error(f"❌ {error_msg}")
            if sync_log:
                await self._complete_sync_log(sync_log, "timeout", error_msg)
            return None
            
        except Exception as e:
            error_msg = f"拉取统计异常: {str(e)}"
            logger.error(f"❌ {error_msg}")
            if sync_log:
                await self._complete_sync_log(sync_log, "error", error_msg)
            return None
    
    async def sync_all_workers(self, config_data: Dict[str, Any]) -> Dict[str, Any]:
        """同步所有Worker"""
        results = {
            "total_workers": 0,
            "success_count": 0,
            "failed_count": 0,
            "results": []
        }
        
        worker_endpoints = settings.WORKER_ENDPOINTS
        if not worker_endpoints:
            logger.warning("⚠️ 未配置Worker端点")
            return results
        
        results["total_workers"] = len(worker_endpoints)
        
        # 并发同步所有Worker
        tasks = []
        for endpoint in worker_endpoints:
            task = self._sync_single_worker(endpoint, config_data)
            tasks.append(task)
        
        # 等待所有任务完成
        sync_results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # 统计结果
        for i, result in enumerate(sync_results):
            endpoint = worker_endpoints[i]
            
            if isinstance(result, Exception):
                results["failed_count"] += 1
                results["results"].append({
                    "endpoint": endpoint,
                    "success": False,
                    "error": str(result)
                })
            elif result:
                results["success_count"] += 1
                results["results"].append({
                    "endpoint": endpoint,
                    "success": True
                })
            else:
                results["failed_count"] += 1
                results["results"].append({
                    "endpoint": endpoint,
                    "success": False,
                    "error": "Unknown error"
                })
        
        logger.info(f"📊 Worker同步完成: {results['success_count']}/{results['total_workers']} 成功")
        return results
    
    async def _sync_single_worker(self, endpoint: str, config_data: Dict[str, Any]) -> bool:
        """同步单个Worker"""
        try:
            # 推送配置
            config_success = await self.push_config_to_worker(endpoint, config_data)
            
            # 拉取统计（可选）
            stats_data = await self.pull_stats_from_worker(endpoint)
            
            # 如果拉取到统计数据，保存到数据库
            if stats_data:
                await self._save_worker_stats(endpoint, stats_data)
            
            return config_success
            
        except Exception as e:
            logger.error(f"❌ 同步Worker {endpoint} 异常: {e}")
            return False
    
    async def _save_worker_stats(self, worker_endpoint: str, stats_data: Dict[str, Any]) -> bool:
        """保存Worker统计数据"""
        try:
            # 提取Worker ID
            worker_id = worker_endpoint.split("//")[-1].split("/")[0]  # 从URL提取域名作为ID
            
            # 保存请求统计
            request_stats = stats_data.get("request_stats", {})
            if request_stats:
                await self.stats_service.record_worker_stats(worker_id, request_stats)
            
            # 保存其他统计数据...
            # 这里可以根据需要扩展更多统计数据的保存逻辑
            
            logger.info(f"✅ Worker统计数据保存成功: {worker_id}")
            return True
            
        except Exception as e:
            logger.error(f"❌ 保存Worker统计数据失败: {e}")
            return False
    
    async def _create_sync_log(self, worker_endpoint: str, sync_type: str, direction: str, data_size: int = 0) -> Optional[SyncLog]:
        """创建同步日志"""
        try:
            db = self.db()
            
            # 提取Worker ID
            worker_id = worker_endpoint.split("//")[-1].split("/")[0]
            
            sync_log = SyncLog(
                worker_id=worker_id,
                sync_type=sync_type,
                direction=direction,
                status="pending",
                data_size=data_size,
                started_at=datetime.now()
            )
            
            db.add(sync_log)
            db.commit()
            db.refresh(sync_log)
            db.close()
            
            return sync_log
            
        except Exception as e:
            logger.error(f"创建同步日志失败: {e}")
            return None
    
    async def _complete_sync_log(self, sync_log: SyncLog, status: str, error_message: str = None, 
                                data_size: int = None, records_count: int = None):
        """完成同步日志"""
        try:
            if not sync_log:
                return
            
            db = self.db()
            
            # 重新查询日志对象（避免会话问题）
            log = db.query(SyncLog).filter(SyncLog.id == sync_log.id).first()
            if not log:
                db.close()
                return
            
            # 更新日志状态
            log.status = status
            log.completed_at = datetime.now()
            log.duration = int((log.completed_at - log.started_at).total_seconds() * 1000)
            
            if error_message:
                log.error_message = error_message
            
            if data_size is not None:
                log.data_size = data_size
            
            if records_count is not None:
                log.records_count = records_count
            
            db.commit()
            db.close()
            
        except Exception as e:
            logger.error(f"完成同步日志失败: {e}")
    
    async def get_worker_health_status(self, worker_endpoint: str) -> Dict[str, Any]:
        """获取Worker健康状态"""
        try:
            async with httpx.AsyncClient(**self.client_config) as client:
                health_url = f"{worker_endpoint.rstrip('/')}/health"

                # 获取API密钥
                from src.services.web_config_service import WebConfigService
                web_config_service = WebConfigService()
                settings = await web_config_service.get_system_settings()
                api_key = settings.worker_api_key if settings else None

                # 构建请求头
                headers = {"User-Agent": "DataCenter-Health/1.0"}
                if api_key:
                    headers["X-API-Key"] = api_key

                response = await client.get(health_url, headers=headers)
                
                if response.status_code == 200:
                    return {
                        "status": "healthy",
                        "endpoint": worker_endpoint,
                        "response_time": response.elapsed.total_seconds(),
                        "data": response.json()
                    }
                else:
                    return {
                        "status": "unhealthy",
                        "endpoint": worker_endpoint,
                        "error": f"HTTP {response.status_code}"
                    }
                    
        except Exception as e:
            return {
                "status": "error",
                "endpoint": worker_endpoint,
                "error": str(e)
            }
