"""
日志管理API端点 - 参考 emby-toolkit 简化版本
"""
import os
import re
import gzip
from typing import List, Dict, Any, Optional
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, Query, Response
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from src.api.v1.endpoints.auth import get_current_user
from src.models.auth import User

router = APIRouter()

# 响应模型
class LogResponse(BaseModel):
    success: bool
    message: str
    data: Dict[str, Any] = None

class LogSearchResult(BaseModel):
    file: str
    line_num: int
    content: str
    date: str

class LogBlock(BaseModel):
    file: str
    date: str
    lines: List[str]

def get_log_directory() -> str:
    """获取日志目录路径"""
    # 在Docker环境中使用/app/config/logs，本地开发使用./logs
    if os.path.exists("/app/config"):
        log_dir = "/app/config/logs"
    else:
        log_dir = os.path.join(os.getcwd(), "logs")

    if not os.path.exists(log_dir):
        os.makedirs(log_dir, exist_ok=True)
    return log_dir

@router.get("/list", response_model=List[str])
async def list_log_files(
    current_user: User = Depends(get_current_user)
):
    """列出日志目录下的所有日志文件"""
    try:
        log_dir = get_log_directory()
        if not os.path.exists(log_dir):
            return []
            
        all_files = os.listdir(log_dir)
        log_files = [f for f in all_files if f.startswith('app.log')]
        
        # 智能排序：app.log 在最前，然后是 .1, .2, .3...
        def sort_key(filename):
            if filename == 'app.log':
                return -1
            parts = filename.split('.')
            # 处理 app.log.1, app.log.2 等格式
            if len(parts) == 3 and parts[0] == 'app' and parts[1] == 'log':
                try:
                    return int(parts[2])
                except ValueError:
                    pass
            return float('inf')
        
        log_files.sort(key=sort_key)
        return log_files
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"无法读取日志文件列表: {str(e)}")

@router.get("/view")
async def view_log_file(
    filename: str = Query(..., description="日志文件名"),
    current_user: User = Depends(get_current_user)
):
    """查看指定日志文件的内容"""
    # 安全检查：防止目录遍历攻击
    if not filename or not filename.startswith('app.log') or '..' in filename:
        raise HTTPException(status_code=403, detail="禁止访问非日志文件")
    
    log_dir = get_log_directory()
    full_path = os.path.join(log_dir, filename)
    
    # 确认路径在日志目录内
    if not os.path.abspath(full_path).startswith(os.path.abspath(log_dir)):
        raise HTTPException(status_code=403, detail="检测到非法路径访问")
    
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="文件未找到")
    
    try:
        # 直接读取文件（不处理.gz压缩文件，简化实现）
        with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()

        # 反转行顺序（最新的在前）
        lines.reverse()
        content = "".join(lines)

        return PlainTextResponse(content)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"读取文件 '{filename}' 时发生错误: {str(e)}")

@router.get("/search", response_model=List[LogSearchResult])
async def search_logs(
    q: str = Query(..., description="搜索关键词"),
    current_user: User = Depends(get_current_user)
):
    """在所有日志文件中搜索关键词（筛选模式）"""
    if not q.strip():
        raise HTTPException(status_code=400, detail="搜索关键词不能为空")
    
    TIMESTAMP_REGEX = re.compile(r"^(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2})")
    search_results = []
    
    try:
        log_dir = get_log_directory()
        if not os.path.exists(log_dir):
            return []
            
        all_files = os.listdir(log_dir)
        log_files = [f for f in all_files if f.startswith('app.log')]
        
        # 排序文件（从新到旧）
        def sort_key(filename):
            if filename == 'app.log':
                return -1
            parts = filename.split('.')
            if len(parts) == 3 and parts[0] == 'app' and parts[1] == 'log':
                try:
                    return int(parts[2])
                except ValueError:
                    pass
            return float('inf')
        
        log_files.sort(key=sort_key)
        
        # 搜索每个文件
        for filename in log_files:
            full_path = os.path.join(log_dir, filename)
            try:
                # 直接读取文件（简化实现）
                with open(full_path, 'rt', encoding='utf-8', errors='ignore') as f:
                    for line_num, line in enumerate(f, 1):
                        if q.lower() in line.lower():
                            match = TIMESTAMP_REGEX.search(line)
                            line_date = match.group(1) if match else ""
                            
                            search_results.append(LogSearchResult(
                                file=filename,
                                line_num=line_num,
                                content=line.strip(),
                                date=line_date
                            ))
            except Exception as e:
                # 单个文件读取失败，记录但继续
                continue
        
        # 按日期排序（最新的在前）
        search_results.sort(key=lambda x: x.date, reverse=True)
        return search_results
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"搜索过程中发生错误: {str(e)}")

@router.get("/search_context", response_model=List[LogBlock])
async def search_logs_with_context(
    q: str = Query(..., description="搜索关键词"),
    current_user: User = Depends(get_current_user)
):
    """在所有日志文件中搜索完整的处理块（定位模式）"""
    if not q.strip():
        raise HTTPException(status_code=400, detail="搜索关键词不能为空")
    
    # 这里简化处理，直接返回匹配的行作为块
    TIMESTAMP_REGEX = re.compile(r"^(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2})")
    found_blocks = []
    
    try:
        log_dir = get_log_directory()
        if not os.path.exists(log_dir):
            return []
            
        all_files = os.listdir(log_dir)
        log_files = [f for f in all_files if f.startswith('app.log')]
        log_files.sort(reverse=True)  # 从新到旧
        
        for filename in log_files:
            full_path = os.path.join(log_dir, filename)
            try:
                # 直接读取文件（简化实现）
                with open(full_path, 'rt', encoding='utf-8', errors='ignore') as f:
                    current_block = []
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        
                        # 如果包含搜索关键词，开始收集上下文
                        if q.lower() in line.lower():
                            if not current_block:
                                current_block = [line]
                            else:
                                current_block.append(line)
                        elif current_block:
                            # 继续收集上下文（可以设置最大行数限制）
                            current_block.append(line)
                            if len(current_block) > 10:  # 限制块大小
                                break
                    
                    if current_block:
                        block_date = "Unknown Date"
                        if current_block:
                            match = TIMESTAMP_REGEX.search(current_block[0])
                            if match:
                                block_date = match.group(1).split(' ')[0]
                        
                        found_blocks.append(LogBlock(
                            file=filename,
                            date=block_date,
                            lines=current_block
                        ))
                        
            except Exception as e:
                continue
        
        # 按日期排序
        found_blocks.sort(key=lambda x: x.date, reverse=True)
        return found_blocks
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"上下文搜索过程中发生错误: {str(e)}")

@router.get("/levels", response_model=List[str])
async def get_log_levels(
    current_user: User = Depends(get_current_user)
):
    """获取可用的日志级别"""
    return ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]

# 保留原有的简单接口以保持兼容性
@router.get("", response_model=Dict[str, Any])
async def get_logs_simple(
    limit: int = Query(100, description="返回记录数量"),
    level: str = Query(None, description="日志级别过滤"),
    current_user: User = Depends(get_current_user)
):
    """获取简单日志数据（兼容性接口）"""
    from datetime import datetime
    
    # 返回简单的测试数据
    test_logs = []
    levels = ['INFO', 'WARNING', 'ERROR', 'DEBUG']
    messages = [
        '系统启动成功',
        'Worker连接建立',
        '配置更新完成',
        'API请求处理',
        '数据同步完成',
        '用户登录成功',
        '缓存清理完成',
        '定时任务执行'
    ]

    for i in range(min(limit, 20)):
        level_filter = level.upper() if level else None
        log_level = level_filter if level_filter and level_filter in levels else levels[i % len(levels)]

        test_logs.append({
            "id": i + 1,
            "worker_id": f"worker-{i % 3 + 1}",
            "level": log_level,
            "message": f"{messages[i % len(messages)]} - 测试日志 {i + 1}",
            "category": "system",
            "source": "data-center",
            "ip_address": f"192.168.1.{100 + i % 50}",
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })

    return {
        "logs": test_logs,
        "total": len(test_logs),
        "message": "测试数据 - API工作正常"
    }
