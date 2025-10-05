"""
配置管理API端点
"""
from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from src.services.config_service import ConfigService
from src.models.config import UAConfig, IPBlacklist

router = APIRouter()

# Pydantic模型
class UAConfigCreate(BaseModel):
    name: str
    user_agent: str
    hourly_limit: int = 100
    enabled: bool = True
    path_specific_limits: Dict[str, int] = {}

class UAConfigUpdate(BaseModel):
    user_agent: str = None
    hourly_limit: int = None
    enabled: bool = None
    path_specific_limits: Dict[str, int] = None

class IPBlacklistCreate(BaseModel):
    ip_address: str
    reason: str = None

class ConfigResponse(BaseModel):
    success: bool
    message: str
    data: Any = None

# 依赖注入
def get_config_service() -> ConfigService:
    return ConfigService()

@router.get("/ua", response_model=List[Dict])
async def get_ua_configs(config_service: ConfigService = Depends(get_config_service)):
    """获取所有UA配置"""
    try:
        configs = await config_service.get_ua_configs()
        return [config.to_dict() for config in configs]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/ua/{name}", response_model=Dict)
async def get_ua_config(name: str, config_service: ConfigService = Depends(get_config_service)):
    """获取指定UA配置"""
    try:
        config = await config_service.get_ua_config_by_name(name)
        if not config:
            raise HTTPException(status_code=404, detail="配置不存在")
        return config.to_dict()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/ua", response_model=ConfigResponse)
async def create_ua_config(
    config_data: UAConfigCreate, 
    config_service: ConfigService = Depends(get_config_service)
):
    """创建UA配置"""
    try:
        config = await config_service.create_ua_config(
            name=config_data.name,
            user_agent=config_data.user_agent,
            hourly_limit=config_data.hourly_limit,
            enabled=config_data.enabled,
            path_specific_limits=config_data.path_specific_limits
        )
        
        if config:
            return ConfigResponse(
                success=True,
                message="UA配置创建成功",
                data=config.to_dict()
            )
        else:
            return ConfigResponse(
                success=False,
                message="UA配置创建失败，可能已存在同名配置"
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/ua/{name}", response_model=ConfigResponse)
async def update_ua_config(
    name: str,
    config_data: UAConfigUpdate,
    config_service: ConfigService = Depends(get_config_service)
):
    """更新UA配置"""
    try:
        # 过滤None值
        update_data = {k: v for k, v in config_data.dict().items() if v is not None}
        
        success = await config_service.update_ua_config(name, **update_data)
        
        if success:
            return ConfigResponse(
                success=True,
                message="UA配置更新成功"
            )
        else:
            return ConfigResponse(
                success=False,
                message="UA配置更新失败，配置不存在"
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/ua/{name}/toggle", response_model=ConfigResponse)
async def toggle_ua_config(
    name: str,
    config_service: ConfigService = Depends(get_config_service)
):
    """切换UA配置启用状态"""
    try:
        success = await config_service.toggle_ua_config(name)
        
        if success:
            return ConfigResponse(
                success=True,
                message="UA配置状态切换成功"
            )
        else:
            return ConfigResponse(
                success=False,
                message="UA配置状态切换失败，配置不存在"
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/ua/{name}", response_model=ConfigResponse)
async def delete_ua_config(
    name: str,
    config_service: ConfigService = Depends(get_config_service)
):
    """删除UA配置"""
    try:
        success = await config_service.delete_ua_config(name)
        
        if success:
            return ConfigResponse(
                success=True,
                message="UA配置删除成功"
            )
        else:
            return ConfigResponse(
                success=False,
                message="UA配置删除失败，配置不存在或不能删除"
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/blacklist", response_model=List[Dict])
async def get_ip_blacklist(config_service: ConfigService = Depends(get_config_service)):
    """获取IP黑名单"""
    try:
        blacklist = await config_service.get_ip_blacklist()
        return [item.to_dict() for item in blacklist]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/blacklist", response_model=ConfigResponse)
async def add_ip_to_blacklist(
    blacklist_data: IPBlacklistCreate,
    config_service: ConfigService = Depends(get_config_service)
):
    """添加IP到黑名单"""
    try:
        entry = await config_service.add_ip_to_blacklist(
            ip_address=blacklist_data.ip_address,
            reason=blacklist_data.reason
        )
        
        if entry:
            return ConfigResponse(
                success=True,
                message="IP添加到黑名单成功",
                data=entry.to_dict()
            )
        else:
            return ConfigResponse(
                success=False,
                message="IP添加到黑名单失败"
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/blacklist/{ip_address}", response_model=ConfigResponse)
async def remove_ip_from_blacklist(
    ip_address: str,
    config_service: ConfigService = Depends(get_config_service)
):
    """从黑名单移除IP"""
    try:
        success = await config_service.remove_ip_from_blacklist(ip_address)
        
        if success:
            return ConfigResponse(
                success=True,
                message="IP从黑名单移除成功"
            )
        else:
            return ConfigResponse(
                success=False,
                message="IP从黑名单移除失败，IP不存在"
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/export", response_model=Dict[str, Any])
async def export_config_for_worker(config_service: ConfigService = Depends(get_config_service)):
    """导出配置给Worker使用"""
    try:
        config_data = await config_service.export_config_for_worker()
        return config_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
