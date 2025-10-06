"""
Web界面配置管理服务
"""
import logging
from typing import Dict, Any, Optional, List
from sqlalchemy.orm import Session
from src.database import get_db_sync
from src.models.web_config import WebConfig, SystemSettings

logger = logging.getLogger(__name__)

class WebConfigService:
    """Web界面配置管理服务"""
    
    def __init__(self):
        self.db = get_db_sync
    
    async def get_system_settings(self) -> Optional[SystemSettings]:
        """获取系统设置"""
        try:
            db = self.db()
            settings = db.query(SystemSettings).first()
            db.close()
            return settings
        except Exception as e:
            logger.error(f"获取系统设置失败: {e}")
            return None
    
    async def create_default_system_settings(self) -> SystemSettings:
        """创建默认系统设置"""
        try:
            db = self.db()
            
            # 检查是否已存在设置
            existing = db.query(SystemSettings).first()
            if existing:
                db.close()
                return existing
            
            # 创建默认设置
            settings = SystemSettings()
            db.add(settings)
            db.commit()
            db.refresh(settings)
            db.close()
            
            logger.info("✅ 创建默认系统设置成功")
            return settings
            
        except Exception as e:
            logger.error(f"创建默认系统设置失败: {e}")
            raise
    
    async def update_system_settings(self, settings_data: Dict[str, Any]) -> bool:
        """更新系统设置"""
        try:
            db = self.db()
            
            # 获取现有设置
            settings = db.query(SystemSettings).first()
            if not settings:
                # 如果不存在，创建新的
                settings = SystemSettings()
                db.add(settings)
            
            # 更新字段
            for key, value in settings_data.items():
                if hasattr(settings, key):
                    setattr(settings, key, value)
            
            db.commit()
            db.close()
            
            logger.info("✅ 系统设置更新成功")
            return True
            
        except Exception as e:
            logger.error(f"更新系统设置失败: {e}")
            return False
    
    async def get_config_by_category(self, category: str) -> List[WebConfig]:
        """根据分类获取配置"""
        try:
            db = self.db()
            configs = db.query(WebConfig).filter(WebConfig.category == category).all()
            db.close()
            return configs
        except Exception as e:
            logger.error(f"获取配置失败: {e}")
            return []
    
    async def get_config_value(self, category: str, key: str) -> Optional[Any]:
        """获取配置值"""
        try:
            db = self.db()
            config = db.query(WebConfig).filter(
                WebConfig.category == category,
                WebConfig.key == key
            ).first()
            db.close()
            
            if not config:
                return None
            
            # 根据类型转换值
            if config.value_type == "int":
                return int(config.value) if config.value else 0
            elif config.value_type == "bool":
                return config.value.lower() in ("true", "1", "yes") if config.value else False
            elif config.value_type == "json":
                import json
                try:
                    return json.loads(config.value) if config.value else {}
                except:
                    return {}
            else:
                return config.value
                
        except Exception as e:
            logger.error(f"获取配置值失败: {e}")
            return None
    
    async def set_config_value(self, category: str, key: str, value: Any, 
                              value_type: str = "string", description: str = None,
                              is_sensitive: bool = False) -> bool:
        """设置配置值"""
        try:
            db = self.db()
            
            # 查找现有配置
            config = db.query(WebConfig).filter(
                WebConfig.category == category,
                WebConfig.key == key
            ).first()
            
            # 转换值为字符串
            if value_type == "json":
                import json
                str_value = json.dumps(value) if value is not None else "{}"
            else:
                str_value = str(value) if value is not None else ""
            
            if config:
                # 更新现有配置
                config.value = str_value
                config.value_type = value_type
                if description:
                    config.description = description
                config.is_sensitive = is_sensitive
            else:
                # 创建新配置
                config = WebConfig(
                    category=category,
                    key=key,
                    value=str_value,
                    value_type=value_type,
                    description=description,
                    is_sensitive=is_sensitive
                )
                db.add(config)
            
            db.commit()
            db.close()
            
            logger.info(f"✅ 配置设置成功: {category}.{key}")
            return True
            
        except Exception as e:
            logger.error(f"设置配置值失败: {e}")
            return False
    
    async def delete_config(self, category: str, key: str) -> bool:
        """删除配置"""
        try:
            db = self.db()
            
            config = db.query(WebConfig).filter(
                WebConfig.category == category,
                WebConfig.key == key
            ).first()
            
            if config:
                db.delete(config)
                db.commit()
                logger.info(f"✅ 配置删除成功: {category}.{key}")
                result = True
            else:
                logger.warning(f"⚠️ 配置不存在: {category}.{key}")
                result = False
            
            db.close()
            return result
            
        except Exception as e:
            logger.error(f"删除配置失败: {e}")
            return False
    
    async def get_all_configs(self) -> Dict[str, List[Dict]]:
        """获取所有配置（按分类分组）"""
        try:
            db = self.db()
            configs = db.query(WebConfig).all()
            db.close()
            
            # 按分类分组
            grouped_configs = {}
            for config in configs:
                category = config.category
                if category not in grouped_configs:
                    grouped_configs[category] = []
                grouped_configs[category].append(config.to_dict())
            
            return grouped_configs
            
        except Exception as e:
            logger.error(f"获取所有配置失败: {e}")
            return {}
    
    async def init_default_configs(self):
        """初始化默认配置"""
        try:
            # 创建默认系统设置
            await self.create_default_system_settings()
            
            # 创建默认Web配置
            default_configs = [
                {
                    "category": "telegram",
                    "key": "bot_token",
                    "value": "",
                    "value_type": "string",
                    "description": "Telegram机器人Token",
                    "is_sensitive": True
                },
                {
                    "category": "telegram",
                    "key": "admin_user_ids",
                    "value": "",
                    "value_type": "string",
                    "description": "管理员用户ID列表（逗号分隔）",
                    "is_sensitive": False
                },
                {
                    "category": "worker",
                    "key": "endpoints",
                    "value": "",
                    "value_type": "string",
                    "description": "Worker端点列表（逗号分隔）",
                    "is_sensitive": False
                },
                {
                    "category": "worker",
                    "key": "api_key",
                    "value": "",
                    "value_type": "string",
                    "description": "Worker API验证密钥",
                    "is_sensitive": True
                },
                {
                    "category": "sync",
                    "key": "interval_hours",
                    "value": "1",
                    "value_type": "int",
                    "description": "同步间隔（小时）",
                    "is_sensitive": False
                },
                {
                    "category": "sync",
                    "key": "retry_attempts",
                    "value": "3",
                    "value_type": "int",
                    "description": "同步重试次数",
                    "is_sensitive": False
                },
                {
                    "category": "sync",
                    "key": "timeout_seconds",
                    "value": "30",
                    "value_type": "int",
                    "description": "同步超时时间（秒）",
                    "is_sensitive": False
                }
            ]
            
            for config_data in default_configs:
                # 检查配置是否已存在
                existing_value = await self.get_config_value(
                    config_data["category"], 
                    config_data["key"]
                )
                
                if existing_value is None:
                    await self.set_config_value(
                        category=config_data["category"],
                        key=config_data["key"],
                        value=config_data["value"],
                        value_type=config_data["value_type"],
                        description=config_data["description"],
                        is_sensitive=config_data["is_sensitive"]
                    )
            
            logger.info("✅ 默认配置初始化完成")
            
        except Exception as e:
            logger.error(f"初始化默认配置失败: {e}")
            raise


def get_web_config_service() -> WebConfigService:
    """获取Web配置服务实例"""
    return WebConfigService()
