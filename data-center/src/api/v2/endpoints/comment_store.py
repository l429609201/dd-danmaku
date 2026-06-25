"""
本地弹幕兜底存储管理接口

- 统计概览（文件数/总大小/上限/占比）
- 上限配置
- 条目列表（分页+搜索）
- 单条删除 / 清空全部 / 手动 LRU 清理
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from src.api.v2.deps import get_current_user, require_operator
from src.api.v2.schemas import ApiResult, PageResult
from src.models_v2 import LocalUser
from src.services_v2.comment_store_service import comment_store_service, DANMAKU_DIR
from src.services_v2.db_stats_service import collect_comment_store_stats

logger = logging.getLogger(__name__)
router = APIRouter()


class MaxBytesUpdate(BaseModel):
    """上限配置（GB）"""
    max_gb: float


@router.get("/stats")
async def store_stats(_: LocalUser = Depends(get_current_user)):
    """弹幕存储统计概览 + 当前目录"""
    data = collect_comment_store_stats()
    data["dir"] = DANMAKU_DIR
    return ApiResult(data=data)


@router.put("/max-bytes")
async def update_max_bytes(body: MaxBytesUpdate,
                           _: LocalUser = Depends(require_operator)):
    """更新存储上限（GB→字节），并立即按新上限做一次 LRU 清理"""
    max_bytes = int(max(0.0, body.max_gb) * 1024 * 1024 * 1024)
    comment_store_service.set_max_bytes(max_bytes)
    return ApiResult(message=f"上限已更新为 {body.max_gb} GB",
                     data={"max_bytes": max_bytes})


@router.get("/entries")
async def list_entries(
    keyword: Optional[str] = None,
    page: int = 1, page_size: int = Query(20, le=100),
    _: LocalUser = Depends(get_current_user),
):
    """弹幕条目列表（分页+按 episode_id 搜索）"""
    result = comment_store_service.list_entries(
        page=page, page_size=page_size, keyword=keyword or "")
    return PageResult(total=result["total"], items=result["items"])


@router.get("/entries/{episode_id}")
async def get_entry(episode_id: str, _: LocalUser = Depends(get_current_user)):
    """查看单条弹幕详情（元数据 + 弹幕预览）"""
    detail = comment_store_service.get_detail(episode_id)
    if not detail:
        return ApiResult(success=False, message="条目不存在")
    return ApiResult(data=detail)


@router.delete("/entries/{episode_id}")
async def delete_entry(episode_id: str, _: LocalUser = Depends(require_operator)):
    """删除单条弹幕（文件+记录）"""
    ok = comment_store_service.delete_entry(episode_id)
    if not ok:
        return ApiResult(success=False, message="条目不存在")
    return ApiResult(message="已删除")


@router.post("/cleanup")
async def manual_cleanup(_: LocalUser = Depends(require_operator)):
    """手动触发 LRU 清理"""
    result = comment_store_service.manual_cleanup()
    freed_mb = round(result["freed"] / 1024 / 1024, 1)
    return ApiResult(message=f"清理完成，释放 {freed_mb} MB", data=result)


@router.delete("/all")
async def clear_all(_: LocalUser = Depends(require_operator)):
    """清空全部弹幕"""
    count = comment_store_service.clear_all()
    return ApiResult(message=f"已清空 {count} 条弹幕", data={"deleted": count})
