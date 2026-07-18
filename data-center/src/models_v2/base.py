"""
models_v2 基础定义

新架构统一使用项目现有的 Base（src.database.Base），
保证 Base.metadata.create_all() 能一次性创建所有 v2 新表。
旧 models 包不再导入，彻底废弃旧表结构。
"""
from sqlalchemy import Column, DateTime

# 复用现有 Base，保证单一 metadata，避免出现两个 declarative_base
from src.database import Base
# 统一使用项目本地时区时间（naive datetime）
from src.utils import naive_now


def now():
    """统一时间函数：返回本地时区的 naive datetime"""
    return naive_now()


class TimestampMixin:
    """统一时间字段，所有新表保持一致的 created_at / updated_at"""
    created_at = Column(DateTime, default=now, nullable=False)
    updated_at = Column(DateTime, default=now, onupdate=now, nullable=False)


__all__ = ["Base", "TimestampMixin", "now"]
