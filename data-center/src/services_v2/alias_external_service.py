"""
外部源别名补充（阶段 8）：TMDB / Bangumi.tv。

用途：阶段 6 的本地算法匹配不到候选的空结果词，走这里拿外部平台的别名，
再用这些别名回本地库二次匹配。

关键点——**最终目标是「dandanplay 能搜到的标题」，不是外部平台的标题**。
所以外部别名只是中间跳板：拿 TMDB 的多语言标题去本地 media_library 里找
对应条目，找到了才写别名；找不到说明 dandanplay 确实没收录，记下来不再重试。

产出一律 status=pending，需人工确认。外部数据同样会错（同名不同作、
中文译名多版本），不能直接上线。
"""
import logging
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import httpx

from src.database import get_db_sync
from src.models_v2 import AppSetting, MediaAlias, MediaLibrary
from src.services_v2.media_meta_service import (
    media_meta_service, normalize_alias, strip_season,
)

logger = logging.getLogger(__name__)


class AliasExternalService:
    """外部源别名补充（TMDB / Bangumi.tv）"""

    async def supplement(self, max_calls: Optional[int] = None) -> Dict[str, Any]:
        """给本地匹配不到的空结果词，用外部源别名做二次匹配。

        流程：空结果词 → 剥季号取基础词 → 查外部源拿多语言别名
              → 用别名回本地 media_library 匹配 → 命中则写 pending 别名
        """
        import asyncio
        cfg = await asyncio.to_thread(self._load_config)
        if not cfg["enabled"]:
            return {"enabled": False}
        if cfg["provider"] == "tmdb" and not cfg["tmdb_key"]:
            return {"enabled": False, "reason": "未配置 TMDB API Key"}

        limit = max_calls or cfg["max_calls"]
        terms = await asyncio.to_thread(self._load_unmatched_terms, limit)
        stat = {"enabled": True, "scanned": 0, "matched": 0,
                "no_external": 0, "no_local": 0, "failed": 0}

        for term, hit in terms:
            stat["scanned"] += 1
            base, _season = strip_season(term)
            if not base or len(base) < 2:
                stat["no_external"] += 1
                continue
            try:
                titles = await self._fetch_titles(cfg, base)
            except Exception as ex:
                stat["failed"] += 1
                logger.warning(f"⚠️ 外部源查询失败 term={term}: {ex}")
                continue
            if not titles:
                stat["no_external"] += 1
                continue
            # 拿外部别名回本地匹配：外部标题只是跳板，落点必须是本地条目
            anime_id = await asyncio.to_thread(self._match_local, titles)
            if not anime_id:
                stat["no_local"] += 1
                continue
            n = await asyncio.to_thread(
                self._save_alias, term, anime_id, hit, cfg["provider"])
            stat["matched"] += n
        logger.info(f"🌐 外部源别名补充完成: {stat}")
        return stat

    async def _fetch_titles(self, cfg: dict, base: str) -> List[str]:
        """查外部源，返回候选标题列表（含多语言别名）"""
        if cfg["provider"] == "bgm":
            return await self._fetch_bgm(base)
        return await self._fetch_tmdb(cfg["tmdb_key"], base)

    @staticmethod
    async def _fetch_tmdb(api_key: str, base: str) -> List[str]:
        """TMDB 搜索 + 取 alternative_titles。

        选 TMDB 而非只用 BGM：现网数据里国产动画占绝对多数
        （凡人修仙传/吞噬星空/沧元图），TMDB 的中文标题覆盖优于 BGM。
        """
        out: List[str] = []
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                "https://api.themoviedb.org/3/search/multi",
                params={"api_key": api_key, "query": base,
                        "language": "zh-CN", "page": 1},
            )
            r.raise_for_status()
            results = (r.json().get("results") or [])[:3]
            for item in results:
                for k in ("name", "title", "original_name", "original_title"):
                    v = item.get(k)
                    if v:
                        out.append(str(v))
                # 取该条目的别名列表（中文译名常在这里）
                mtype = item.get("media_type")
                mid = item.get("id")
                if mtype in ("tv", "movie") and mid:
                    try:
                        ar = await client.get(
                            f"https://api.themoviedb.org/3/{mtype}/{mid}/alternative_titles",
                            params={"api_key": api_key},
                        )
                        if ar.status_code == 200:
                            key = "results" if mtype == "tv" else "titles"
                            for t in (ar.json().get(key) or []):
                                if t.get("title"):
                                    out.append(str(t["title"]))
                    except Exception:
                        pass  # 别名取不到不影响主标题匹配
        return out

    @staticmethod
    async def _fetch_bgm(base: str) -> List[str]:
        """Bangumi.tv 搜索，返回中日文标题。无需 API Key。"""
        out: List[str] = []
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                f"https://api.bgm.tv/search/subject/{quote(base)}",
                params={"type": 2, "responseGroup": "small", "max_results": 5},
                headers={"User-Agent": "dd-danmaku/1.0"},
            )
            if r.status_code != 200:
                return out
            for item in (r.json().get("list") or [])[:5]:
                for k in ("name_cn", "name"):
                    if item.get(k):
                        out.append(str(item[k]))
        return out

    # ---------- DB 读写（同步，由调用方放线程池） ----------

    @staticmethod
    def _load_unmatched_terms(limit: int):
        """取「空结果且本地没匹配到候选」的词，按命中降序。

        排除已有别名记录的（含 pending / rejected）：
        - 有 pending 说明阶段 6 已给出候选，不必再花外部调用
        - 有 rejected 说明人工判过不匹配，别再翻出来
        """
        from sqlalchemy import text as sql_text
        db = get_db_sync()
        try:
            sql = sql_text("""
                SELECT arc.cache_key, arc.hit_count
                FROM api_response_cache arc
                WHERE arc.is_empty = 1
                  AND arc.api_path LIKE '/api/v2/search/%'
                ORDER BY arc.hit_count DESC
                LIMIT :lim
            """)
            rows = [(r[0] or "", r[1] or 0)
                    for r in db.execute(sql, {"lim": limit * 3})]
            out = []
            for cache_key, hit in rows:
                from src.services_v2.media_meta_service import parse_search_term
                term = parse_search_term(cache_key)
                if not term:
                    continue
                norm = normalize_alias(term)
                if db.query(MediaAlias).filter(
                        MediaAlias.alias_norm == norm).first():
                    continue
                out.append((term, hit))
                if len(out) >= limit:
                    break
            return out
        finally:
            db.close()

    @staticmethod
    def _match_local(titles: List[str]) -> Optional[str]:
        """用外部源给的标题列表去本地 media_library 找条目。

        先试归一化完全相等（最可靠），再退化为包含匹配。
        这一步是整个流程的落点——匹配不上就说明 dandanplay 没收录，
        写别名也没用。
        """
        if not titles:
            return None
        db = get_db_sync()
        try:
            norms = {normalize_alias(t) for t in titles if t}
            norms.discard("")
            if not norms:
                return None
            # 精确匹配优先：外部标题与本地标题归一化后一致
            for t in titles:
                nt = normalize_alias(t)
                if not nt or len(nt) < 2:
                    continue
                for m in db.query(MediaLibrary).filter(
                        MediaLibrary.title.like(f"%{t}%")).limit(10).all():
                    if m.title and m.anime_id and normalize_alias(m.title) == nt:
                        return m.anime_id
            # 退化：取包含外部标题的最短本地条目（通常是主条目而非副标题版）
            best = None
            for t in titles:
                if not t or len(t) < 2:
                    continue
                for m in db.query(MediaLibrary).filter(
                        MediaLibrary.title.like(f"%{t}%")).limit(10).all():
                    if not (m.title and m.anime_id):
                        continue
                    if best is None or len(m.title) < len(best[1]):
                        best = (m.anime_id, m.title)
            return best[0] if best else None
        finally:
            db.close()

    @staticmethod
    def _save_alias(term: str, anime_id: str, hit: int, provider: str) -> int:
        """写 pending 别名。source 记 tmdb / bgm，便于区分来源与回溯。"""
        db = get_db_sync()
        try:
            item = [{"alias": term, "alias_norm": normalize_alias(term),
                     "lang": None, "title_type": "search_keyword"}]
            n = media_meta_service.upsert_aliases(
                db, anime_id, item, source=provider, status="pending",
                confidence=70, hit_snapshot=hit or 0,
            )
            db.commit()
            return n
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def _load_config() -> dict:
        keys = ("alias_external_enabled", "alias_external_provider",
                "alias_tmdb_api_key", "alias_external_max_calls")
        db = get_db_sync()
        try:
            got = {r.key: r.value for r in db.query(AppSetting).filter(
                AppSetting.key.in_(keys)).all()}
        finally:
            db.close()
        enabled = str(got.get("alias_external_enabled") or "").lower() in (
            "1", "true", "yes", "on")
        try:
            max_calls = int(got.get("alias_external_max_calls") or 30)
        except Exception:
            max_calls = 30
        return {
            "enabled": enabled,
            "provider": (got.get("alias_external_provider") or "tmdb").lower(),
            "tmdb_key": got.get("alias_tmdb_api_key") or "",
            "max_calls": max_calls,
        }


alias_external_service = AliasExternalService()
