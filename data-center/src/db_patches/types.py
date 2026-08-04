"""数据库补丁定义。"""
from dataclasses import dataclass
from typing import Callable

from sqlalchemy.engine import Engine


@dataclass(frozen=True)
class Patch:
    """一个可追踪的数据库补丁。"""

    patch_id: str
    description: str
    apply: Callable[[Engine], bool]
    destructive: bool = False
