"""
时间处理工具模块
统一管理时区和时间格式化
"""
import os
from datetime import datetime, timezone, timedelta
from typing import Optional, Union
import pytz
import logging

logger = logging.getLogger(__name__)

# 默认时区配置
DEFAULT_TIMEZONE = "Asia/Shanghai"
UTC_TIMEZONE = timezone.utc

class TimeUtils:
    """时间处理工具类"""
    
    def __init__(self, default_timezone: str = None):
        """
        初始化时间工具
        
        Args:
            default_timezone: 默认时区，如果不指定则使用环境变量或默认值
        """
        self._default_timezone = self._get_timezone(default_timezone)
        logger.info(f"⏰ 时间工具初始化完成，默认时区: {self._default_timezone}")
    
    def _get_timezone(self, timezone_str: Optional[str] = None) -> pytz.BaseTzInfo:
        """
        获取时区对象
        
        Args:
            timezone_str: 时区字符串
            
        Returns:
            时区对象
        """
        if not timezone_str:
            # 优先使用环境变量
            timezone_str = os.getenv('TZ', os.getenv('TIMEZONE', DEFAULT_TIMEZONE))
        
        try:
            return pytz.timezone(timezone_str)
        except pytz.UnknownTimeZoneError:
            logger.warning(f"⚠️ 未知时区 {timezone_str}，使用默认时区 {DEFAULT_TIMEZONE}")
            return pytz.timezone(DEFAULT_TIMEZONE)
    
    def now(self, timezone_str: Optional[str] = None) -> datetime:
        """
        获取当前时间
        
        Args:
            timezone_str: 指定时区，如果不指定则使用默认时区
            
        Returns:
            当前时间（带时区信息）
        """
        tz = self._get_timezone(timezone_str) if timezone_str else self._default_timezone
        return datetime.now(tz)
    
    def utc_now(self) -> datetime:
        """
        获取当前UTC时间

        Returns:
            当前UTC时间
        """
        return datetime.now(UTC_TIMEZONE)

    def naive_now(self, timezone_str: Optional[str] = None) -> datetime:
        """
        获取当前时间（不带时区信息，但已调整到指定时区）

        Args:
            timezone_str: 指定时区，如果不指定则使用默认时区或TZ环境变量

        Returns:
            当前时间（naive datetime，已调整到指定时区）
        """
        tz = self._get_timezone(timezone_str) if timezone_str else self._default_timezone
        # 获取带时区的时间，然后移除时区信息
        aware_time = datetime.now(tz)
        return aware_time.replace(tzinfo=None)
    
    def to_local(self, dt: datetime, timezone_str: Optional[str] = None) -> datetime:
        """
        将时间转换为本地时区
        
        Args:
            dt: 要转换的时间
            timezone_str: 目标时区，如果不指定则使用默认时区
            
        Returns:
            转换后的时间
        """
        tz = self._get_timezone(timezone_str) if timezone_str else self._default_timezone
        
        # 如果输入时间没有时区信息，假设为UTC
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC_TIMEZONE)
        
        return dt.astimezone(tz)
    
    def to_utc(self, dt: datetime) -> datetime:
        """
        将时间转换为UTC
        
        Args:
            dt: 要转换的时间
            
        Returns:
            UTC时间
        """
        # 如果输入时间没有时区信息，假设为默认时区
        if dt.tzinfo is None:
            dt = self._default_timezone.localize(dt)
        
        return dt.astimezone(UTC_TIMEZONE)
    
    def format_datetime(self, dt: datetime, format_str: str = "%Y-%m-%d %H:%M:%S") -> str:
        """
        格式化时间
        
        Args:
            dt: 要格式化的时间
            format_str: 格式字符串
            
        Returns:
            格式化后的时间字符串
        """
        # 转换为本地时区
        local_dt = self.to_local(dt)
        return local_dt.strftime(format_str)
    
    def format_now(self, format_str: str = "%Y-%m-%d %H:%M:%S") -> str:
        """
        格式化当前时间
        
        Args:
            format_str: 格式字符串
            
        Returns:
            格式化后的当前时间字符串
        """
        return self.format_datetime(self.now(), format_str)
    
    def parse_datetime(self, dt_str: str, format_str: str = "%Y-%m-%d %H:%M:%S", 
                      timezone_str: Optional[str] = None) -> datetime:
        """
        解析时间字符串
        
        Args:
            dt_str: 时间字符串
            format_str: 格式字符串
            timezone_str: 时区，如果不指定则使用默认时区
            
        Returns:
            解析后的时间对象
        """
        dt = datetime.strptime(dt_str, format_str)
        tz = self._get_timezone(timezone_str) if timezone_str else self._default_timezone
        return tz.localize(dt)
    
    def get_timezone_offset(self, timezone_str: Optional[str] = None) -> str:
        """
        获取时区偏移量
        
        Args:
            timezone_str: 时区字符串
            
        Returns:
            时区偏移量字符串，如 "+08:00"
        """
        tz = self._get_timezone(timezone_str) if timezone_str else self._default_timezone
        now = datetime.now(tz)
        offset = now.strftime('%z')
        # 格式化为 +08:00 形式
        if len(offset) == 5:
            return f"{offset[:3]}:{offset[3:]}"
        return offset
    
    def is_same_day(self, dt1: datetime, dt2: datetime, 
                   timezone_str: Optional[str] = None) -> bool:
        """
        判断两个时间是否在同一天
        
        Args:
            dt1: 第一个时间
            dt2: 第二个时间
            timezone_str: 时区
            
        Returns:
            是否在同一天
        """
        local_dt1 = self.to_local(dt1, timezone_str)
        local_dt2 = self.to_local(dt2, timezone_str)
        return local_dt1.date() == local_dt2.date()
    
    def get_day_range(self, dt: datetime, timezone_str: Optional[str] = None) -> tuple[datetime, datetime]:
        """
        获取指定日期的开始和结束时间
        
        Args:
            dt: 指定日期
            timezone_str: 时区
            
        Returns:
            (开始时间, 结束时间) 元组
        """
        tz = self._get_timezone(timezone_str) if timezone_str else self._default_timezone
        local_dt = self.to_local(dt, timezone_str)
        
        # 当天开始时间 (00:00:00)
        start_time = tz.localize(datetime.combine(local_dt.date(), datetime.min.time()))
        # 当天结束时间 (23:59:59.999999)
        end_time = tz.localize(datetime.combine(local_dt.date(), datetime.max.time()))
        
        return start_time, end_time


# 全局时间工具实例
time_utils = TimeUtils()

# 便捷函数
def now(timezone_str: Optional[str] = None) -> datetime:
    """获取当前时间"""
    return time_utils.now(timezone_str)

def utc_now() -> datetime:
    """获取当前UTC时间"""
    return time_utils.utc_now()

def naive_now(timezone_str: Optional[str] = None) -> datetime:
    """获取当前时间（不带时区信息，但已调整到指定时区）"""
    return time_utils.naive_now(timezone_str)

def to_local(dt: datetime, timezone_str: Optional[str] = None) -> datetime:
    """转换为本地时区"""
    return time_utils.to_local(dt, timezone_str)

def to_utc(dt: datetime) -> datetime:
    """转换为UTC时区"""
    return time_utils.to_utc(dt)

def format_datetime(dt: datetime, format_str: str = "%Y-%m-%d %H:%M:%S") -> str:
    """格式化时间"""
    return time_utils.format_datetime(dt, format_str)

def format_now(format_str: str = "%Y-%m-%d %H:%M:%S") -> str:
    """格式化当前时间"""
    return time_utils.format_now(format_str)
