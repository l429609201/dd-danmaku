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
                push_url = f"{worker_endpoint.rstrip('/')}/worker-api/config/update"
                
                # 获取API密钥
                from src.services.config_manager import config_manager
                api_key = config_manager.get_data_center_api_key()

                logger.info(f"🔑 数据中心向Worker推送配置:")
                logger.info(f"   - Worker端点: {worker_endpoint}")
                logger.info(f"   - API Key: {api_key[:8] + '...' if api_key else '未配置'}")
                logger.info(f"   - API Key长度: {len(api_key) if api_key else 0}")

                # 构建请求头
                headers = {
                    "Content-Type": "application/json",
                    "User-Agent": "DataCenter-Sync/1.0"
                }

                if api_key:
                    headers["X-API-Key"] = api_key
                    logger.info(f"✅ 已添加X-API-Key头部")
                else:
                    logger.warning(f"⚠️ 未配置API Key，请求将不包含X-API-Key头部")

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
                stats_url = f"{worker_endpoint.rstrip('/')}/worker-api/stats"

                # 获取API密钥
                from src.services.config_manager import config_manager
                api_key = config_manager.get_data_center_api_key()

                logger.info(f"📊 数据中心向Worker拉取统计:")
                logger.info(f"   - Worker端点: {worker_endpoint}")
                logger.info(f"   - API Key: {api_key[:8] + '...' if api_key else '未配置'}")
                logger.info(f"   - API Key长度: {len(api_key) if api_key else 0}")

                # 构建请求头
                headers = {"User-Agent": "DataCenter-Sync/1.0"}
                if api_key:
                    headers["X-API-Key"] = api_key
                    logger.info(f"✅ 已添加X-API-Key头部")
                else:
                    logger.warning(f"⚠️ 未配置API Key，请求将不包含X-API-Key头部")

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

    async def process_worker_logs(self, worker_id: str, logs_data: List[Dict[str, Any]]) -> bool:
        """处理Worker推送的日志数据"""
        try:
            if not logs_data:
                logger.info(f"Worker {worker_id} 没有日志数据")
                return True

            logger.info(f"开始处理Worker {worker_id} 的 {len(logs_data)} 条日志")
            logger.debug(f"日志数据示例: {logs_data[:2] if len(logs_data) > 0 else '无'}")

            db = self.db()

            # 导入SystemLog模型
            from src.models.logs import SystemLog
            from datetime import datetime

            # 批量保存日志（增量保存，避免重复）
            saved_count = 0
            for log_entry in logs_data:
                # 使用 id 或 timestamp 作为唯一标识符
                log_id = log_entry.get('id')
                log_timestamp = log_entry.get('timestamp')

                # 如果没有 id，使用 timestamp 作为唯一标识符
                if not log_id and log_timestamp:
                    log_id = f"{worker_id}-{log_timestamp}"

                if not log_id:
                    logger.warning(f"日志缺少id和timestamp，跳过: {log_entry}")
                    continue

                # 检查是否已存在相同ID的日志（避免重复保存）
                existing_log = db.query(SystemLog).filter(
                    SystemLog.request_id == log_id,
                    SystemLog.worker_id == worker_id
                ).first()

                if existing_log:
                    continue  # 跳过已存在的日志

                # 获取日志数据
                log_data = log_entry.get('data', {})

                # 处理IP地址字段（Worker可能使用ip或source_ip）
                ip_address = log_data.get('ip') or log_data.get('source_ip')

                # 处理User-Agent字段（Worker可能使用userAgent或user_agent）
                user_agent = log_data.get('userAgent') or log_data.get('user_agent')

                # 转换时间戳为 datetime（如果是毫秒时间戳）
                created_at = None
                if log_timestamp:
                    try:
                        # 假设时间戳是毫秒
                        created_at = datetime.fromtimestamp(log_timestamp / 1000)
                    except Exception as e:
                        logger.warning(f"转换时间戳失败: {e}")

                system_log = SystemLog(
                    worker_id=worker_id,
                    level=log_entry.get('level', 'INFO').upper(),
                    message=log_entry.get('message', ''),
                    details=log_data,
                    category='worker_sync',
                    source=f'worker-{worker_id}',
                    request_id=log_id,
                    ip_address=ip_address,
                    user_agent=user_agent
                )

                # 如果有时间戳，设置创建时间
                if created_at:
                    system_log.created_at = created_at

                db.add(system_log)
                saved_count += 1

            db.commit()
            db.close()

            logger.info(f"✅ 处理Worker日志成功: {worker_id}, 接收{len(logs_data)}条, 新增{saved_count}条")
            return True

        except Exception as e:
            logger.error(f"❌ 处理Worker日志失败: {e}")
            return False

    async def process_worker_stats(self, worker_id: str, stats_data: Dict[str, Any]) -> bool:
        """处理Worker推送的统计数据"""
        try:
            # 使用统计服务记录数据
            success = await self.stats_service.record_worker_stats(worker_id, stats_data)

            if success:
                logger.info(f"✅ 处理Worker统计数据成功: {worker_id}")
            else:
                logger.error(f"❌ 处理Worker统计数据失败: {worker_id}")

            return success

        except Exception as e:
            logger.error(f"❌ 处理Worker统计数据异常: {e}")
            return False

    async def process_worker_config_status(self, worker_id: str, config_status: Dict[str, Any]) -> bool:
        """处理Worker配置状态"""
        try:
            # 这里可以记录配置同步状态
            logger.info(f"✅ 收到Worker配置状态: {worker_id}")
            logger.debug(f"配置状态详情: {config_status}")

            # 可以在这里保存配置状态到数据库
            # 暂时只记录日志
            return True

        except Exception as e:
            logger.error(f"❌ 处理Worker配置状态失败: {e}")
            return False

    async def process_worker_config(self, worker_id: str, config_data: Dict[str, Any]) -> bool:
        """处理Worker推送的配置数据"""
        try:
            from src.models.config import WorkerConfig

            logger.info(f"📋 处理Worker {worker_id} 的配置数据")

            db = self.db()

            # 查找或创建配置记录
            worker_config = db.query(WorkerConfig).filter(
                WorkerConfig.worker_id == worker_id
            ).first()

            if not worker_config:
                worker_config = WorkerConfig(worker_id=worker_id)

            # 更新配置数据
            worker_config.ua_configs = config_data.get("ua_configs", {})
            worker_config.ip_blacklist = config_data.get("ip_blacklist", [])
            worker_config.secret_usage = config_data.get("secret_usage", {})
            worker_config.last_update = config_data.get("last_update", 0)

            db.add(worker_config)
            db.commit()
            db.close()

            logger.info(f"✅ Worker配置数据保存成功: {worker_id}")
            return True

        except Exception as e:
            logger.error(f"❌ 处理Worker配置数据失败: {e}")
            return False

    async def process_worker_request_stats(self, worker_id: str, stats_data: Dict[str, Any]) -> bool:
        """处理Worker推送的IP请求统计数据"""
        try:
            from src.models.stats import IPRequestStats, RequestStats
            from datetime import datetime

            logger.info(f"📊 处理Worker {worker_id} 的IP请求统计数据")
            logger.debug(f"📊 接收到的统计数据: {stats_data}")

            db = self.db()

            # 获取统计数据
            by_ip = stats_data.get("by_ip", {})
            total_requests = stats_data.get("total_requests", 0)

            logger.info(f"📊 总请求数: {total_requests}")
            logger.info(f"📊 by_ip数据类型: {type(by_ip)}, 数据长度: {len(by_ip) if isinstance(by_ip, dict) else 'N/A'}")
            current_hour = datetime.now().replace(minute=0, second=0, microsecond=0)

            # 更新 RequestStats 表的总请求数（用于仪表盘统计）
            request_stats = db.query(RequestStats).filter(
                RequestStats.worker_id == worker_id,
                RequestStats.date_hour == current_hour
            ).first()

            if not request_stats:
                request_stats = RequestStats(
                    worker_id=worker_id,
                    date_hour=current_hour
                )
                db.add(request_stats)

            # 更新总请求数和活跃IP数
            request_stats.total_requests = total_requests
            request_stats.active_ips_count = len(by_ip)

            # 计算违规总数
            total_violations = sum(ip_stats.get("violations", 0) for ip_stats in by_ip.values())
            request_stats.blocked_requests = total_violations

            # 计算成功请求数（总请求 - 违规）
            request_stats.successful_requests = max(0, total_requests - total_violations)

            logger.info(f"📊 更新RequestStats: 总请求={total_requests}, 活跃IP={len(by_ip)}, 违规={total_violations}")

            # 批量保存IP请求统计
            saved_count = 0
            for ip_address, ip_stats in by_ip.items():
                try:
                    # 查找或创建IP统计记录
                    ip_request_stat = db.query(IPRequestStats).filter(
                        IPRequestStats.worker_id == worker_id,
                        IPRequestStats.ip_address == ip_address,
                        IPRequestStats.date_hour == current_hour
                    ).first()

                    if not ip_request_stat:
                        ip_request_stat = IPRequestStats(
                            worker_id=worker_id,
                            ip_address=ip_address,
                            date_hour=current_hour
                        )

                    # 更新统计数据
                    ip_request_stat.total_count = ip_stats.get("total_count", 0)
                    ip_request_stat.violations = ip_stats.get("violations", 0)
                    ip_request_stat.paths = ip_stats.get("paths", {})

                    db.add(ip_request_stat)
                    saved_count += 1

                except Exception as e:
                    logger.error(f"❌ 保存IP {ip_address} 的统计数据失败: {e}")
                    continue

            db.commit()
            db.close()

            logger.info(f"✅ Worker IP请求统计数据保存成功: {worker_id}, 共保存 {saved_count} 条IP统计")
            return True

        except Exception as e:
            logger.error(f"❌ 处理Worker IP请求统计数据失败: {e}")
            return False
    
    async def query_worker_logs(self, worker_id: str = None, limit: int = 100) -> List[Dict[str, Any]]:
        """查询Worker推送的日志数据"""
        try:
            from src.models.logs import SystemLog

            db = self.db()

            # 构建查询
            query = db.query(SystemLog).filter(SystemLog.category == 'worker_sync')

            if worker_id:
                query = query.filter(SystemLog.worker_id == worker_id)

            # 按时间倒序，获取最新的日志
            logs = query.order_by(SystemLog.created_at.desc()).limit(limit).all()

            db.close()

            # 转换为字典列表
            result = []
            for log in logs:
                result.append({
                    "id": log.id,
                    "worker_id": log.worker_id,
                    "level": log.level,
                    "message": log.message,
                    "timestamp": int(log.created_at.timestamp() * 1000) if log.created_at else 0,
                    "data": log.details or {}
                })

            logger.info(f"✅ 查询Worker {worker_id} 的日志成功，共 {len(result)} 条")
            return result

        except Exception as e:
            logger.error(f"❌ 查询Worker日志失败: {e}")
            return []

    async def query_worker_request_stats(self, worker_id: str = None, limit: int = 100) -> List[Dict[str, Any]]:
        """查询Worker推送的 IP 请求统计数据"""
        try:
            from src.models.stats import IPRequestStats

            db = self.db()

            # 构建查询
            query = db.query(IPRequestStats)

            if worker_id:
                query = query.filter(IPRequestStats.worker_id == worker_id)

            # 按时间倒序，获取最新的统计
            stats = query.order_by(IPRequestStats.date_hour.desc()).limit(limit).all()

            db.close()

            # 转换为字典列表
            result = []
            for stat in stats:
                result.append({
                    "id": stat.id,
                    "worker_id": stat.worker_id,
                    "ip_address": stat.ip_address,
                    "total_count": stat.total_count,
                    "violations": stat.violations,
                    "paths": stat.paths or {},
                    "date_hour": stat.date_hour.isoformat() if stat.date_hour else None
                })

            logger.info(f"✅ 查询Worker {worker_id} 的IP请求统计成功，共 {len(result)} 条")
            return result

        except Exception as e:
            logger.error(f"❌ 查询Worker IP请求统计失败: {e}")
            return []

    async def get_worker_health_status(self, worker_endpoint: str) -> Dict[str, Any]:
        """获取Worker健康状态"""
        try:
            async with httpx.AsyncClient(**self.client_config) as client:
                health_url = f"{worker_endpoint.rstrip('/')}/health"

                # 获取API密钥
                from src.services.config_manager import config_manager
                api_key = config_manager.get_data_center_api_key()

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
