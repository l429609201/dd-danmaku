"""
配置管理服务
"""
import logging
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session

from src.database import get_db_sync
from src.models.config import UAConfig, IPBlacklist, WorkerConfig, SystemConfig

logger = logging.getLogger(__name__)

class ConfigService:
    """配置管理服务类"""
    
    def __init__(self):
        self.db = get_db_sync
    
    async def get_ua_configs(self) -> List[UAConfig]:
        """获取所有UA配置"""
        try:
            db = self.db()
            configs = db.query(UAConfig).order_by(UAConfig.created_at.desc()).all()
            db.close()
            return configs
        except Exception as e:
            logger.error(f"获取UA配置失败: {e}")
            return []
    
    async def get_ua_config_by_name(self, name: str) -> Optional[UAConfig]:
        """根据名称获取UA配置"""
        try:
            db = self.db()
            config = db.query(UAConfig).filter(UAConfig.name == name).first()
            db.close()
            return config
        except Exception as e:
            logger.error(f"获取UA配置失败: {e}")
            return None
    
    async def create_ua_config(self, name: str, user_agent: str, hourly_limit: int = 100, 
                              enabled: bool = True, path_specific_limits: Dict = None) -> Optional[UAConfig]:
        """创建UA配置"""
        try:
            db = self.db()
            
            # 检查是否已存在
            existing = db.query(UAConfig).filter(UAConfig.name == name).first()
            if existing:
                db.close()
                logger.warning(f"UA配置 {name} 已存在")
                return None
            
            config = UAConfig(
                name=name,
                user_agent=user_agent,
                hourly_limit=hourly_limit,
                enabled=enabled,
                path_specific_limits=path_specific_limits or {}
            )
            
            db.add(config)
            db.commit()
            db.refresh(config)
            db.close()
            
            logger.info(f"创建UA配置成功: {name}")
            return config
            
        except Exception as e:
            logger.error(f"创建UA配置失败: {e}")
            return None
    
    async def update_ua_config(self, name: str, **kwargs) -> bool:
        """更新UA配置"""
        try:
            db = self.db()
            config = db.query(UAConfig).filter(UAConfig.name == name).first()
            
            if not config:
                db.close()
                return False
            
            for key, value in kwargs.items():
                if hasattr(config, key):
                    setattr(config, key, value)
            
            db.commit()
            db.close()
            
            logger.info(f"更新UA配置成功: {name}")
            return True
            
        except Exception as e:
            logger.error(f"更新UA配置失败: {e}")
            return False
    
    async def toggle_ua_config(self, name: str) -> bool:
        """切换UA配置启用状态"""
        try:
            db = self.db()
            config = db.query(UAConfig).filter(UAConfig.name == name).first()
            
            if not config:
                db.close()
                return False
            
            config.enabled = not config.enabled
            db.commit()
            db.close()
            
            logger.info(f"切换UA配置状态成功: {name} -> {config.enabled}")
            return True
            
        except Exception as e:
            logger.error(f"切换UA配置状态失败: {e}")
            return False
    
    async def delete_ua_config(self, name: str) -> bool:
        """删除UA配置"""
        try:
            if name == "default":
                logger.warning("不能删除默认配置")
                return False
            
            db = self.db()
            config = db.query(UAConfig).filter(UAConfig.name == name).first()
            
            if not config:
                db.close()
                return False
            
            db.delete(config)
            db.commit()
            db.close()
            
            logger.info(f"删除UA配置成功: {name}")
            return True
            
        except Exception as e:
            logger.error(f"删除UA配置失败: {e}")
            return False
    
    async def get_ip_blacklist(self) -> List[IPBlacklist]:
        """获取IP黑名单"""
        try:
            db = self.db()
            blacklist = db.query(IPBlacklist).order_by(IPBlacklist.created_at.desc()).all()
            db.close()
            return blacklist
        except Exception as e:
            logger.error(f"获取IP黑名单失败: {e}")
            return []
    
    async def add_ip_to_blacklist(self, ip_address: str, reason: str = None) -> Optional[IPBlacklist]:
        """添加IP到黑名单"""
        try:
            db = self.db()
            
            # 检查是否已存在
            existing = db.query(IPBlacklist).filter(IPBlacklist.ip_address == ip_address).first()
            if existing:
                db.close()
                logger.warning(f"IP {ip_address} 已在黑名单中")
                return existing
            
            blacklist_entry = IPBlacklist(
                ip_address=ip_address,
                reason=reason,
                enabled=True
            )
            
            db.add(blacklist_entry)
            db.commit()
            db.refresh(blacklist_entry)
            db.close()
            
            logger.info(f"添加IP到黑名单成功: {ip_address}")
            return blacklist_entry
            
        except Exception as e:
            logger.error(f"添加IP到黑名单失败: {e}")
            return None
    
    async def remove_ip_from_blacklist(self, ip_address: str) -> bool:
        """从黑名单移除IP"""
        try:
            db = self.db()
            entry = db.query(IPBlacklist).filter(IPBlacklist.ip_address == ip_address).first()
            
            if not entry:
                db.close()
                return False
            
            db.delete(entry)
            db.commit()
            db.close()
            
            logger.info(f"从黑名单移除IP成功: {ip_address}")
            return True
            
        except Exception as e:
            logger.error(f"从黑名单移除IP失败: {e}")
            return False
    
    async def get_worker_configs(self) -> List[WorkerConfig]:
        """获取Worker配置"""
        try:
            db = self.db()
            configs = db.query(WorkerConfig).order_by(WorkerConfig.created_at.desc()).all()
            db.close()
            return configs
        except Exception as e:
            logger.error(f"获取Worker配置失败: {e}")
            return []
    
    async def get_system_config(self, key: str) -> Optional[str]:
        """获取系统配置"""
        try:
            db = self.db()
            config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
            db.close()
            return config.value if config else None
        except Exception as e:
            logger.error(f"获取系统配置失败: {e}")
            return None
    
    async def set_system_config(self, key: str, value: str, description: str = None) -> bool:
        """设置系统配置"""
        try:
            db = self.db()
            config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
            
            if config:
                config.value = value
                if description:
                    config.description = description
            else:
                config = SystemConfig(
                    key=key,
                    value=value,
                    description=description
                )
                db.add(config)
            
            db.commit()
            db.close()
            
            logger.info(f"设置系统配置成功: {key}")
            return True
            
        except Exception as e:
            logger.error(f"设置系统配置失败: {e}")
            return False
    
    async def export_config_for_worker(self) -> Dict[str, Any]:
        """导出配置给Worker使用"""
        try:
            ua_configs = await self.get_ua_configs()
            blacklist = await self.get_ip_blacklist()
            
            # 转换为Worker需要的格式
            ua_config_dict = {}
            for config in ua_configs:
                if config.enabled:
                    ua_config_dict[config.name] = {
                        "userAgent": config.user_agent,
                        "hourlyLimit": config.hourly_limit,
                        "enabled": config.enabled,
                        "pathSpecificLimits": config.path_specific_limits or {}
                    }
            
            blacklist_dict = {}
            for ip_entry in blacklist:
                if ip_entry.enabled:
                    blacklist_dict[ip_entry.ip_address] = {
                        "reason": ip_entry.reason or "Manual blacklist",
                        "enabled": ip_entry.enabled
                    }
            
            return {
                "ua_configs": ua_config_dict,
                "ip_blacklist": blacklist_dict,
                "updated_at": "now"
            }
            
        except Exception as e:
            logger.error(f"导出配置失败: {e}")
            return {}

    async def save_ua_configs(self, ua_configs: List[Dict[str, Any]]) -> bool:
        """保存UA配置"""
        try:
            db = self.db()

            # 清空现有配置
            db.query(UAConfig).delete()

            # 添加新配置
            for config_data in ua_configs:
                ua_config = UAConfig(
                    name=config_data.get("name", ""),
                    user_agent=config_data.get("userAgent", ""),
                    enabled=config_data.get("enabled", True),
                    max_requests_per_hour=config_data.get("maxRequestsPerHour", -1),
                    max_requests_per_day=config_data.get("maxRequestsPerDay", -1),
                    description=config_data.get("description", "")
                )
                db.add(ua_config)

            db.commit()
            db.close()
            return True

        except Exception as e:
            logger.error(f"保存UA配置失败: {e}")
            return False

    async def save_ip_blacklist(self, ip_list: List[str]) -> bool:
        """保存IP黑名单"""
        try:
            db = self.db()

            # 清空现有黑名单
            db.query(IPBlacklist).delete()

            # 添加新IP
            for ip in ip_list:
                if ip.strip():  # 跳过空字符串
                    ip_blacklist = IPBlacklist(
                        ip_address=ip.strip(),
                        reason="手动添加",
                        enabled=True
                    )
                    db.add(ip_blacklist)

            db.commit()
            db.close()
            return True

        except Exception as e:
            logger.error(f"保存IP黑名单失败: {e}")
            return False
