"""
Redis 热缓存服务

新架构分工：
- Redis 保存响应体、R2 本地镜像、短期计数等热数据；
- SQL 保存 cache_key、redis_key、body_hash、刷新时间等元数据。

Redis 不可用时自动降级（返回 None / 跳过写入），由上层决定是否回退 SQL 冷备。
"""
import hashlib
import logging
from typing import Optional

from src.config import settings

logger = logging.getLogger(__name__)

try:
    import redis.asyncio as aioredis
except Exception:  # pragma: no cover - redis 未安装时不阻塞启动
    aioredis = None


def cache_key_hash(cache_key: str) -> str:
    """对标准化 cache_key 做 sha256，作为 Redis key 的稳定后缀"""
    return hashlib.sha256(cache_key.encode("utf-8")).hexdigest()


class RedisCacheService:
    """Redis 热缓存层封装（asyncio）"""

    def __init__(self):
        self._client = None
        self._enabled = bool(settings.REDIS_ENABLED) and aioredis is not None
        self._prefix = settings.REDIS_PREFIX

    @property
    def enabled(self) -> bool:
        return self._enabled and self._client is not None

    async def connect(self):
        """初始化 Redis 连接；失败则降级，不抛出阻断启动"""
        if not settings.REDIS_ENABLED:
            logger.info("ℹ️ Redis 未启用，缓存体将降级到 SQL")
            return
        if aioredis is None:
            logger.warning("⚠️ 未安装 redis 包，Redis 热缓存不可用")
            self._enabled = False
            return
        try:
            self._client = aioredis.from_url(
                settings.REDIS_URL, decode_responses=True,
            )
            await self._client.ping()
            self._enabled = True
            logger.info(f"✅ Redis 连接成功: {settings.REDIS_URL}")
        except Exception as e:
            logger.error(f"❌ Redis 连接失败，降级到 SQL: {e}")
            self._client = None
            self._enabled = False

    async def close(self):
        """关闭连接"""
        if self._client is not None:
            try:
                await self._client.aclose()
            except Exception:
                pass
            self._client = None

    def _k(self, *parts: str) -> str:
        """拼接带统一前缀的 key"""
        return ":".join([self._prefix, *parts])

    # ---------- 通用读写（key 由调用方构造，内部统一加前缀） ----------
    async def set(self, key: str, value: str, ttl: int = 0) -> bool:
        """通用写入；ttl<=0 表示不过期。成功返回 True"""
        if not self.enabled:
            return False
        try:
            full = self._k(key)
            if ttl and ttl > 0:
                await self._client.set(full, value, ex=ttl)
            else:
                await self._client.set(full, value)
            return True
        except Exception as e:
            logger.warning(f"⚠️ Redis set 失败: {e}")
            return False

    async def get(self, key: str) -> Optional[str]:
        """通用读取；miss / 未连接返回 None"""
        if not self.enabled:
            return None
        try:
            return await self._client.get(self._k(key))
        except Exception as e:
            logger.warning(f"⚠️ Redis get 失败: {e}")
            return None

    async def delete(self, key: str) -> bool:
        """通用删除"""
        if not self.enabled:
            return False
        try:
            await self._client.delete(self._k(key))
            return True
        except Exception as e:
            logger.warning(f"⚠️ Redis delete 失败: {e}")
            return False

    # ---------- 响应体 ----------
    async def get_response(self, cache_key: str) -> Optional[str]:
        """读取响应体；miss / 未连接返回 None"""
        if not self.enabled:
            return None
        try:
            return await self._client.get(
                self._k("api:response", cache_key_hash(cache_key))
            )
        except Exception as e:
            logger.warning(f"⚠️ Redis 读取响应失败: {e}")
            return None

    async def set_response(self, cache_key: str, body: str, ttl_seconds: int):
        """写入响应体，带 TTL"""
        if not self.enabled:
            return
        try:
            await self._client.set(
                self._k("api:response", cache_key_hash(cache_key)),
                body, ex=max(1, ttl_seconds),
            )
        except Exception as e:
            logger.warning(f"⚠️ Redis 写入响应失败: {e}")

    async def delete_response(self, cache_key: str):
        """删除响应体"""
        if not self.enabled:
            return
        try:
            await self._client.delete(
                self._k("api:response", cache_key_hash(cache_key))
            )
        except Exception as e:
            logger.warning(f"⚠️ Redis 删除响应失败: {e}")

    # ---------- R2 comment 本地镜像 ----------
    async def get_r2_comment(self, episode_id: str) -> Optional[str]:
        if not self.enabled:
            return None
        try:
            return await self._client.get(self._k("r2:comment", str(episode_id)))
        except Exception as e:
            logger.warning(f"⚠️ Redis 读取 R2 镜像失败: {e}")
            return None

    async def set_r2_comment(self, episode_id: str, body: str, ttl_seconds: int):
        if not self.enabled:
            return
        try:
            await self._client.set(
                self._k("r2:comment", str(episode_id)),
                body, ex=max(1, ttl_seconds),
            )
        except Exception as e:
            logger.warning(f"⚠️ Redis 写入 R2 镜像失败: {e}")

    # ---------- 计数 ----------
    async def incr_hit(self, cache_key: str) -> int:
        """命中计数 +1，返回当前值；失败返回 0"""
        if not self.enabled:
            return 0
        try:
            return await self._client.incr(
                self._k("api:hit", cache_key_hash(cache_key))
            )
        except Exception as e:
            logger.warning(f"⚠️ Redis 计数失败: {e}")
            return 0


# 全局单例
redis_cache_service = RedisCacheService()
# 别名：新服务统一使用 redis_cache 引用
redis_cache = redis_cache_service
