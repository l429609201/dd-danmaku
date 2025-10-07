"""
系统配置管理器
"""
import logging
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session
from src.database import get_db
from src.models.config import SystemConfig

logger = logging.getLogger(__name__)


class ConfigManager:
    """系统配置管理器"""

    def __init__(self):
        pass
    
    def get_config(self, key: str, default: Any = None) -> Any:
        """获取配置值"""
        try:
            db = next(get_db())
            config = db.query(SystemConfig).filter(SystemConfig.key == key).first()

            if config:
                # 根据配置类型转换值
                return self._convert_value(config.value, config.config_type)
            return default
        except Exception as e:
            logger.error(f"获取配置失败 {key}: {e}")
            return default
        finally:
            db.close()
    
    def set_config(self, key: str, value: Any, description: str = "", config_type: str = "string") -> bool:
        """设置配置值"""
        try:
            db = next(get_db())

            # 查找现有配置
            config = db.query(SystemConfig).filter(SystemConfig.key == key).first()

            if config:
                # 更新现有配置
                config.value = str(value)
                config.description = description
                config.config_type = config_type
            else:
                # 创建新配置
                config = SystemConfig(
                    key=key,
                    value=str(value),
                    description=description,
                    config_type=config_type
                )
                db.add(config)

            db.commit()
            logger.info(f"配置设置成功: {key}")
            return True
        except Exception as e:
            logger.error(f"设置配置失败 {key}: {e}")
            return False
        finally:
            db.close()
    
    def delete_config(self, key: str) -> bool:
        """删除配置"""
        try:
            db = next(get_db())
            config = db.query(SystemConfig).filter(SystemConfig.key == key).first()

            if config:
                db.delete(config)
                db.commit()
                logger.info(f"配置删除成功: {key}")
                return True
            else:
                logger.warning(f"配置不存在: {key}")
                return False
        except Exception as e:
            logger.error(f"删除配置失败 {key}: {e}")
            return False
        finally:
            db.close()
    
    def get_all_configs(self, category: str = None) -> Dict[str, Any]:
        """获取所有配置"""
        try:
            db = next(get_db())
            query = db.query(SystemConfig)

            if category:
                # 如果有分类过滤（虽然当前模型没有category字段，但为了扩展性）
                pass

            configs = query.all()

            result = {}
            for config in configs:
                result[config.key] = self._convert_value(config.value, config.config_type)

            return result
        except Exception as e:
            logger.error(f"获取所有配置失败: {e}")
            return {}
        finally:
            db.close()
    
    def get_configs_list(self) -> List[Dict[str, Any]]:
        """获取配置列表（包含元数据）"""
        try:
            db = next(get_db())
            configs = db.query(SystemConfig).all()

            return [config.to_dict() for config in configs]
        except Exception as e:
            logger.error(f"获取配置列表失败: {e}")
            return []
        finally:
            db.close()
    
    def _convert_value(self, value: str, config_type: str) -> Any:
        """根据配置类型转换值"""
        if not value:
            return None
        
        try:
            if config_type == "int":
                return int(value)
            elif config_type == "float":
                return float(value)
            elif config_type == "bool":
                return value.lower() in ("true", "1", "yes", "on")
            elif config_type == "json":
                import json
                return json.loads(value)
            else:  # string
                return value
        except Exception as e:
            logger.warning(f"配置值转换失败: {value} -> {config_type}, 错误: {e}")
            return value
    
    # 便捷方法
    def get_worker_api_key(self) -> Optional[str]:
        """获取Worker API Key"""
        return self.get_config("worker_api_key")
    
    def set_worker_api_key(self, api_key: str) -> bool:
        """设置Worker API Key"""
        return self.set_config(
            "worker_api_key", 
            api_key, 
            "数据中心访问Worker时使用的API密钥",
            "string"
        )
    
    def get_data_center_api_key(self) -> Optional[str]:
        """获取数据中心API Key"""
        return self.get_config("data_center_api_key")
    
    def set_data_center_api_key(self, api_key: str) -> bool:
        """设置数据中心API Key"""
        return self.set_config(
            "data_center_api_key",
            api_key,
            "Worker向数据中心推送数据时使用的API密钥",
            "string"
        )
    
    def get_telegram_bot_token(self) -> Optional[str]:
        """获取Telegram Bot Token"""
        return self.get_config("telegram_bot_token")
    
    def set_telegram_bot_token(self, token: str) -> bool:
        """设置Telegram Bot Token"""
        return self.set_config(
            "telegram_bot_token",
            token,
            "Telegram机器人Token",
            "string"
        )
    
    def get_telegram_admin_users(self) -> List[int]:
        """获取Telegram管理员用户ID列表"""
        admin_ids = self.get_config("telegram_admin_users", "")
        if not admin_ids:
            return []
        try:
            return [int(uid.strip()) for uid in admin_ids.split(",") if uid.strip()]
        except Exception:
            return []
    
    def set_telegram_admin_users(self, user_ids: List[int]) -> bool:
        """设置Telegram管理员用户ID列表"""
        return self.set_config(
            "telegram_admin_users",
            ",".join(map(str, user_ids)),
            "Telegram机器人管理员用户ID列表（逗号分隔）",
            "string"
        )


# 全局配置管理器实例
config_manager = ConfigManager()
