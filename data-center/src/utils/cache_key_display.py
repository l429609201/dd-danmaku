"""
cache_key 的日志显示化。

cache_key 里的中文是 URL 编码形态（`%E4%B8%8E...`），直接打进日志完全没法读。
这里统一解码成中文，只用于**日志与前端展示**——库里存的、用于查询的
仍是原始编码形态，不要拿本函数的结果去查库。
"""
from urllib.parse import unquote

__all__ = ["pretty_cache_key"]


def pretty_cache_key(cache_key: str, limit: int = 160) -> str:
    """把 cache_key 解码成可读形式，供日志打印。

    - 解码失败或非字符串一律回退原值，绝不因为打日志抛异常
    - 截断在解码之后做：先截断会把 `%E4%B8%8E` 切成 `%E4%B8` 导致乱码，
      这也是原先日志里出现 `...%E8%83%BD%E5` 结尾的原因
    """
    if not cache_key or not isinstance(cache_key, str):
        return str(cache_key or "")
    try:
        # errors="replace"：脏数据里的非法编码序列不应让日志调用失败
        shown = unquote(cache_key, errors="replace")
    except Exception:
        shown = cache_key
    if limit and len(shown) > limit:
        shown = shown[:limit] + "…"
    return shown
