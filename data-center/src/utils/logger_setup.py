"""
日志配置模块 - 参考 emby-toolkit 简化版本
"""
import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from datetime import datetime

# 日志配置常量
LOG_FILE_NAME = "app.log"
DEFAULT_LOG_SIZE_MB = 10
DEFAULT_LOG_BACKUPS = 5

def setup_logging(log_directory: str = None, log_level: str = "INFO"):
    """
    设置日志系统
    
    Args:
        log_directory: 日志目录路径，默认为项目根目录下的logs文件夹
        log_level: 日志级别，默认为INFO
    """
    if log_directory is None:
        log_directory = os.path.join(os.getcwd(), "logs")
    
    # 确保日志目录存在
    if not os.path.exists(log_directory):
        os.makedirs(log_directory, exist_ok=True)
    
    # 获取根logger
    logger = logging.getLogger()
    
    # 清除现有的处理器
    if logger.hasHandlers():
        logger.handlers.clear()
    
    # 设置日志级别
    level = getattr(logging, log_level.upper(), logging.INFO)
    logger.setLevel(level)
    
    # 创建格式化器
    formatter = logging.Formatter(
        '%(asctime)s,%(msecs)03d - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # 1. 控制台处理器
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(level)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    
    # 2. 文件处理器（带轮转）
    log_file_path = os.path.join(log_directory, LOG_FILE_NAME)
    try:
        file_handler = RotatingFileHandler(
            log_file_path,
            maxBytes=DEFAULT_LOG_SIZE_MB * 1024 * 1024,  # 10MB
            backupCount=DEFAULT_LOG_BACKUPS,  # 保留5个备份
            encoding='utf-8'
        )
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
        
        # 记录日志系统启动信息
        logger.info(f"日志系统已初始化 - 文件路径: {log_file_path}")
        logger.info(f"日志轮转配置: {DEFAULT_LOG_SIZE_MB}MB * {DEFAULT_LOG_BACKUPS}个备份")
        
    except Exception as e:
        logger.error(f"配置文件日志处理器失败: {e}")
    
    return logger

def create_test_logs(log_directory: str = None):
    """
    创建一些测试日志数据
    """
    if log_directory is None:
        log_directory = os.path.join(os.getcwd(), "logs")
    
    logger = logging.getLogger(__name__)
    
    # 创建一些测试日志
    test_messages = [
        ("INFO", "系统启动成功"),
        ("INFO", "数据库连接已建立"),
        ("DEBUG", "开始处理用户请求"),
        ("INFO", "用户认证成功"),
        ("WARNING", "检测到异常访问模式"),
        ("ERROR", "数据库查询超时"),
        ("INFO", "系统定时任务执行完成"),
        ("DEBUG", "缓存清理完成"),
        ("INFO", "API请求处理完成"),
        ("INFO", "系统运行正常")
    ]
    
    for level, message in test_messages:
        log_level = getattr(logging, level)
        logger.log(log_level, message)
    
    logger.info("测试日志数据创建完成")

if __name__ == "__main__":
    # 测试日志系统
    setup_logging()
    create_test_logs()
