"""按领域拆分的数据库特殊补丁。"""
from src.db_patches.registry import DESTRUCTIVE_PATCHES, PATCHES
from src.db_patches.runner import apply_patch_registry

__all__ = ["PATCHES", "DESTRUCTIVE_PATCHES", "apply_patch_registry"]
