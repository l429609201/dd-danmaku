"""
媒体元数据提取服务：从 dandanplay /bangumi/{id} 响应中提取外部平台 ID 与多语言别名。

数据来源是已落库的 api_response_entities.raw_json（entity_type='bangumi'），
其中 onlineDatabases[] 已给出各平台完整 URL、titles[] 已给出多语言标题，
所以提取过程纯本地计算，不请求任何外部服务。

两个落点：
- media_external_ids  各平台 ID（正则从 URL 提取）
- media_alias         多语言别名（source=dandanplay_titles，直接 approved）
"""
import logging
import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, unquote, urlparse

# 别名归一化函数的形参名叫 text，这里改名导入避免遮蔽
from sqlalchemy import text as sql_text

from src.models_v2 import MediaAlias, MediaExternalId, MediaLibrary

logger = logging.getLogger(__name__)


# 平台 URL → ID 提取正则。新增平台只加一条即可。
# 匹配不到的平台仍入库（external_id 留空、只存 URL），不丢数据。
URL_PATTERNS: List[Tuple[str, str]] = [
    ("bangumi_tv", r"bangumi\.tv/subject/(\d+)"),
    ("anidb", r"anidb\.net/anime/(\d+)"),
    ("mal", r"myanimelist\.net/anime/(\d+)"),
    ("anilist", r"anilist\.co/anime/(\d+)"),
    ("tmdb", r"themoviedb\.org/tv/(\d+)"),
    ("tmdb_movie", r"themoviedb\.org/movie/(\d+)"),
    ("imdb", r"imdb\.com/title/(tt\d+)"),
    ("tvdb", r"thetvdb\.com/dereferrer/series/(\d+)"),
    ("tvdb_slug", r"thetvdb\.com/series/([^/?&\s]+)"),
    ("anisearch", r"anisearch\.com/anime/(\d+)"),
    ("animeplanet", r"anime-planet\.com/anime/([^/?&\s]+)"),
    ("notifymoe", r"notify\.moe/anime/([^/?&\s]+)"),
]

# 上游 name 字段 → 内部 provider 标识。正则没命中时用它兜底，
# 避免同一平台因 URL 格式变化而产生两个不同的 provider 值。
NAME_TO_PROVIDER: Dict[str, str] = {
    "bangumi.tv": "bangumi_tv",
    "anidb": "anidb",
    "myanimelist": "mal",
    "anilist": "anilist",
    "anisearch": "anisearch",
    "animeplanet": "animeplanet",
    "anime-planet": "animeplanet",
    "tmdb": "tmdb",
    "themoviedb": "tmdb",
    "imdb": "imdb",
    "thetvdb": "tvdb",
    "tvdb": "tvdb",
    "notify.moe": "notifymoe",
}

# 上游 titles[].language 是中文描述串（如「官方标题，简体中文」），
# 这里拆成 (lang, title_type) 两个维度，便于前端按语言筛选。
LANG_KEYWORDS: List[Tuple[str, str]] = [
    ("日语罗马字", "ja-romaji"),
    ("简体中文", "zh-Hans"),
    ("繁体中文", "zh-Hant"),
    ("日语", "ja"),
    ("英语", "en"),
    ("中文", "zh"),
]

# 搜索词命中番剧数上限：超过则认为词太宽泛（如「斗罗大陆」返回 12 部），
# 建立别名反而会让线上解析指向一堆无关条目，直接跳过。
# 阈值 5 的依据见方案 §1.4：命中 1-5 部的缓存条目占绝大多数有效映射。
CACHE_TERM_MAX_ANIMES = 5

# 搜索类接口里承载搜索词的 query 参数名。
# 现网两种都出现过：/search/anime?keyword=X 与 /search/episodes?anime=X
SEARCH_TERM_PARAMS = ("anime", "keyword")

# 季号中文数字 → 阿拉伯数字。用于把「第三季」与「Ⅲ / III / 3」对齐——
# 现网最大的脏数来源就是这个：客户端发中文季号，dandanplay 用罗马数字。
CN_NUM = {
    "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
    "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
}

# 季号/篇章后缀模式。剥掉这些拿到"基础词"，再用基础词去库里找同系列条目。
# 刻意不含「第X章」：章是剧场版内部分章（如「无限城篇 第一章」），
# 不是季号。误当季号会让「鬼灭之刃 第一章」错配到第一季且给出 90 分高置信度。
SEASON_PATTERNS = [
    r"第\s*([0-9一二三四五六七八九十]+)\s*季",
    r"第\s*([0-9一二三四五六七八九十]+)\s*部分",
    r"season\s*([0-9]+)",
    r"\bs([0-9]{1,2})\b",
]

# 无季号语义的尾部修饰：整体剥掉，不产生季号
TAIL_NOISE_PATTERNS = [
    r"[~～][^~～]*[~～]",   # ~到了异世界就拿出真本事~
    r"[^\s]*篇",            # 埃鲁巴夫篇 / 过去篇 / 无限城篇（可能在中间）
    r"第\s*[0-9一二三四五六七八九十]+\s*章",  # 剧场版分章，非季号
    r"剧场版",
    r"最终季",
    r"ova|oad|sp\b",
]


def strip_season(term: str) -> Tuple[str, Optional[int]]:
    """把搜索词拆成 (基础词, 季号)。季号取不到返回 None。

    例：
      「无职转生 第三季 ～到了异世界就拿出真本事～」→ ("无职转生", 3)
      「航海王 埃鲁巴夫篇」                        → ("航海王", None)
      「凡人修仙传」                                → ("凡人修仙传", None)

    这是候选生成的第一步：拿基础词去库里捞同系列的所有条目，
    再用季号从中挑对应的那一部。
    """
    s = normalize_alias(term)
    if not s:
        return "", None

    season = None
    # 循环剥掉所有季号片段，而不是命中一个就停——现网有
    # 「无职转生 第二季 ～…～ 第2部分」这种同时带季号和部分号的写法，
    # 只剥第一个会让「第2部分」残留在基础词里，匹配不到任何条目。
    # season 取第一个命中的（季号语义优先于部分号）。
    for pat in SEASON_PATTERNS:
        while True:
            m = re.search(pat, s, flags=re.IGNORECASE)
            if not m:
                break
            raw = m.group(1)
            num = int(raw) if raw.isdigit() else CN_NUM.get(raw)
            if season is None and num is not None:
                season = num
            s = (s[:m.start()] + " " + s[m.end():])

    for pat in TAIL_NOISE_PATTERNS:
        s = re.sub(pat, " ", s, flags=re.IGNORECASE)

    s = re.sub(r"\s+", " ", s).strip(" -·:：")
    return s, season


def season_of_title(title: str) -> Optional[int]:
    """从库里的规范标题反推季号，用于和搜索词的季号对齐。

    dandanplay 的写法主要是罗马数字（无职转生Ⅲ）——归一化后已是 iii，
    另外也有「第二季」「2nd season」等形式，一并识别。
    第一季通常不带任何标记，返回 None 而非 1，交给调用方按"无标记即第一季"处理。
    """
    s = normalize_alias(title)
    if not s:
        return None
    # 罗马数字（NFKC 后 Ⅲ 已变成 iii）：按长到短匹配，避免 ii 吃掉 iii
    for roman, num in (("viii", 8), ("vii", 7), ("iii", 3), ("vi", 6),
                       ("iv", 4), ("ii", 2), ("ix", 9), ("v", 5)):
        if re.search(rf"{roman}(\s|$)", s):
            return num
    for pat in SEASON_PATTERNS:
        m = re.search(pat, s, flags=re.IGNORECASE)
        if m:
            raw = m.group(1)
            return int(raw) if raw.isdigit() else CN_NUM.get(raw)
    return None


def normalize_alias(text: str) -> str:
    """别名归一化：NFKC 全角转半角 + 小写 + 连续空白合一 + 去首尾空格。

    线上解析查的是 alias_norm 列，所以入库和查询必须走同一个函数，
    否则「Re：从零」和「re:从零」这类差异会命中不到。
    """
    if not text:
        return ""
    # NFKC 把全角字母数字、罗马数字（Ⅲ→III）、波浪号等归一到半角基本形式
    s = unicodedata.normalize("NFKC", str(text))
    s = s.strip().lower()
    s = re.sub(r"\s+", " ", s)
    return s


def parse_language(language: Optional[str]) -> Tuple[Optional[str], str]:
    """把上游 language 描述串解析成 (lang, title_type)。

    上游取值形如：主标题 / 官方标题，简体中文 / 别名，日语罗马字 / 搜索关键词
    """
    raw = (language or "").strip()
    if not raw:
        return None, "alias"

    # title_type：主标题 > 官方标题 > 搜索关键词 > 别名（默认）
    if "主标题" in raw:
        title_type = "main"
    elif "官方标题" in raw:
        title_type = "official"
    elif "搜索关键词" in raw:
        title_type = "search_keyword"
    else:
        title_type = "alias"

    # lang：按 LANG_KEYWORDS 顺序匹配，长词优先（简体中文先于中文）
    lang = None
    for kw, code in LANG_KEYWORDS:
        if kw in raw:
            lang = code
            break
    # 「主标题」「搜索关键词」不带语言后缀，标 unknown 而非 None，便于前端区分
    if lang is None:
        lang = "unknown"
    return lang, title_type


def parse_search_term(cache_key: str) -> Optional[str]:
    """从 cache_key 里取出客户端原始搜索词。

    cache_key 形如 `GET:/api/v2/search/episodes?anime=凡人修仙传`，
    也可能是 URL 编码形态（`anime=%E5%87%A1%E4%BA%BA...`）——现网两种都有，
    parse_qs 会自动解码，编码形态无需特殊处理。

    带 `episode=` 的旧脏键返回其 anime 部分即可：episode 已被 Worker 剥离，
    新键不再带它，这里只是兼容存量数据。
    """
    if not cache_key:
        return None
    # 去掉 `GET:` / `EMPTY:` 之类前缀，只留 path?query
    raw = cache_key.split(":", 1)[1] if ":" in cache_key else cache_key
    try:
        qs = parse_qs(urlparse(raw).query, keep_blank_values=False)
    except Exception:
        return None
    for name in SEARCH_TERM_PARAMS:
        vals = qs.get(name)
        if vals and vals[0].strip():
            # parse_qs 已解码一次；部分历史键是二次编码的，再解一次并容错
            term = vals[0].strip()
            if "%" in term:
                try:
                    term = unquote(term).strip()
                except Exception:
                    pass
            return term or None
    return None


def extract_external_ids(raw: Dict[str, Any]) -> List[Dict[str, Any]]:
    """从 bangumi raw_json 提取外部平台 ID 列表。

    优先用 URL 正则提取 ID；正则不命中时降级为「按 name 归一 provider、
    external_id 留空只存 URL」，保证不丢平台记录。
    """
    out: List[Dict[str, Any]] = []
    seen: set = set()

    databases = raw.get("onlineDatabases")
    if not isinstance(databases, list):
        databases = []

    for item in databases:
        if not isinstance(item, dict):
            continue
        url = (item.get("url") or "").strip()
        name = (item.get("name") or "").strip()
        if not url:
            continue

        provider = None
        external_id = None
        for prov, pattern in URL_PATTERNS:
            m = re.search(pattern, url, re.IGNORECASE)
            if m:
                # tmdb_movie / tvdb_slug 只是 URL 形态不同，归到主 provider
                provider = prov.replace("_movie", "").replace("_slug", "")
                external_id = m.group(1)
                break
        if provider is None:
            provider = NAME_TO_PROVIDER.get(name.lower())
        if provider is None:
            # 完全未知的平台：用 name 生成标识，仍然入库保留 URL
            provider = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
        if not provider:
            continue
        # 同一 provider 只取第一条（唯一约束是 anime_id + provider）
        if provider in seen:
            continue
        seen.add(provider)

        out.append({
            "provider": provider,
            "external_id": external_id,
            "external_url": url[:500],
            # 正则提取到 ID 的可信度更高，仅按 name 兜底的标 70
            "confidence": 95 if external_id else 70,
        })

    # bangumiUrl 是独立字段，onlineDatabases 缺失时可兜底出 bangumi_tv
    if "bangumi_tv" not in seen:
        burl = (raw.get("bangumiUrl") or "").strip()
        if burl:
            m = re.search(r"bangumi\.tv/subject/(\d+)", burl, re.IGNORECASE)
            if m:
                out.append({
                    "provider": "bangumi_tv",
                    "external_id": m.group(1),
                    "external_url": burl[:500],
                    "confidence": 95,
                })
    return out


def extract_aliases(raw: Dict[str, Any]) -> List[Dict[str, Any]]:
    """从 bangumi raw_json 的 titles[] 提取多语言别名。

    同时兜底 animeTitle / searchKeyword 两个独立字段——部分条目 titles[]
    可能残缺，但这两个字段几乎总有值。
    """
    out: List[Dict[str, Any]] = []
    seen_norm: set = set()

    def _add(title: Optional[str], language: Optional[str], fallback_type: str):
        text = (title or "").strip()
        if not text:
            return
        norm = normalize_alias(text)
        # 归一化后为空或本条已出现过则跳过（唯一约束是 alias_norm + anime_id）
        if not norm or norm in seen_norm:
            return
        seen_norm.add(norm)
        lang, title_type = parse_language(language)
        out.append({
            "alias": text[:500],
            "alias_norm": norm[:500],
            "lang": lang,
            "title_type": title_type if language else fallback_type,
        })

    titles = raw.get("titles")
    if isinstance(titles, list):
        for t in titles:
            if isinstance(t, dict):
                _add(t.get("title"), t.get("language"), "alias")

    # 兜底字段：语言未知，类型按语义标注
    _add(raw.get("animeTitle"), None, "main")
    _add(raw.get("searchKeyword"), None, "search_keyword")
    return out


class MediaMetaService:
    """外部 ID 与别名的提取落库服务（同步 DB 操作，由调用方放线程池）"""

    def upsert_external_ids(self, db, anime_id: str,
                            items: List[Dict[str, Any]]) -> int:
        """写入外部平台 ID。不提交事务，供批量复用共享 session。

        source=manual 的行是人工填写的，自动提取一律不覆盖。
        """
        if not anime_id or not items:
            return 0
        existing = {
            r.provider: r
            for r in db.query(MediaExternalId).filter(
                MediaExternalId.anime_id == anime_id
            ).all()
        }
        count = 0
        for it in items:
            provider = it["provider"]
            row = existing.get(provider)
            if row is None:
                row = MediaExternalId(
                    anime_id=anime_id, provider=provider, source="auto",
                )
                db.add(row)
                existing[provider] = row
            elif row.source == "manual":
                # 人工维护的记录不被自动提取覆盖
                continue
            row.external_id = it.get("external_id")
            row.external_url = it.get("external_url")
            row.confidence = it.get("confidence", 0)
            count += 1
        return count

    def upsert_aliases(self, db, anime_id: str, items: List[Dict[str, Any]],
                       source: str = "dandanplay_titles",
                       status: str = "approved",
                       confidence: int = 95,
                       hit_snapshot: int = 0) -> int:
        """写入别名。不提交事务，供批量复用共享 session。

        已存在的行只在「新来源可信度更高」时才升级 status/source，
        避免自动任务把人工确认过的记录打回 pending。
        """
        if not anime_id or not items:
            return 0
        norms = [it["alias_norm"] for it in items if it.get("alias_norm")]
        if not norms:
            return 0
        existing = {
            r.alias_norm: r
            for r in db.query(MediaAlias).filter(
                MediaAlias.anime_id == anime_id,
                MediaAlias.alias_norm.in_(norms),
            ).all()
        }
        count = 0
        for it in items:
            norm = it.get("alias_norm")
            if not norm:
                continue
            row = existing.get(norm)
            if row is None:
                row = MediaAlias(
                    anime_id=anime_id,
                    alias=it["alias"],
                    alias_norm=norm,
                    lang=it.get("lang"),
                    title_type=it.get("title_type"),
                    source=source,
                    status=status,
                    confidence=confidence,
                    hit_snapshot=hit_snapshot,
                )
                db.add(row)
                existing[norm] = row
                count += 1
                continue

            # 已存在：人工确认过的记录（manual / 已 verified）一律不动
            if row.source == "manual" or row.verified_by is not None:
                continue
            # 官方别名可信度最高，可把 pending 的算法结果升级为 approved
            if confidence > (row.confidence or 0):
                row.source = source
                row.status = status
                row.confidence = confidence
                row.lang = it.get("lang") or row.lang
                row.title_type = it.get("title_type") or row.title_type
                count += 1
            # 命中数只增不减，反映最新热度
            if hit_snapshot > (row.hit_snapshot or 0):
                row.hit_snapshot = hit_snapshot
        return count

    def ingest_bangumi_raw(self, db, anime_id: str,
                           raw: Dict[str, Any]) -> Tuple[int, int]:
        """从单条 bangumi raw_json 提取并落库，返回 (外部ID数, 别名数)。

        不提交事务——调用方（一次性脚本 / 增量任务）自行控制批量 commit。
        """
        if not anime_id or not isinstance(raw, dict):
            return 0, 0
        n_ext = self.upsert_external_ids(db, anime_id, extract_external_ids(raw))
        n_alias = self.upsert_aliases(db, anime_id, extract_aliases(raw))
        return n_ext, n_alias

    def ingest_cache_search_terms(self, db, min_cache_id: int = 0,
                                  limit: int = 2000) -> Dict[str, int]:
        """从有结果的搜索缓存提取「搜索词 → animeId」别名。

        这批词的价值在于**已验证能搜到结果**，比算法推断可信得多：
        - 命中 1 部番  → 精确映射，直接 approved（confidence=85）
        - 命中 2-5 部番 → 系列名，pending 待人工确认归属哪季（confidence=60）
        - 命中 ≥6 部番 → 词太宽泛（如「斗罗大陆」12 个结果），做别名无意义，跳过

        返回各档写入统计。不提交事务，调用方控制 commit。
        """
        rows = self._query_cache_term_groups(db, min_cache_id, limit)
        stat = {"scanned": 0, "approved": 0, "pending": 0,
                "skipped_wide": 0, "skipped_noterm": 0, "max_cache_id": min_cache_id}

        for cache_id, cache_key, hit_count, anime_ids in rows:
            stat["scanned"] += 1
            if cache_id > stat["max_cache_id"]:
                stat["max_cache_id"] = cache_id
            n = self.ingest_search_term(db, cache_key, anime_ids, hit_count)
            if n is None:
                stat["skipped_noterm"] += 1
            elif n is False:
                stat["skipped_wide"] += 1
            else:
                stat["approved" if len(anime_ids) == 1 else "pending"] += n
        return stat

    def ingest_search_term(self, db, cache_key: str, anime_ids: List[str],
                           hit_count: int = 0):
        """把单条「搜索词 → animeId 列表」写成别名。

        抽成独立方法是为了让两条路径共用同一套分档规则：
        - 周期任务扫 api_response_cache 表（ingest_cache_search_terms）
        - Worker 写入响应时实时调用（entity_service 的 /search/* 分支）

        否则规则会在两处各写一份，日后调阈值必然漏改一边。

        返回：写入行数 / None（取不到搜索词）/ False（词太宽泛已跳过）
        """
        term = parse_search_term(cache_key)
        if not term:
            return None
        ids = [a for a in (anime_ids or []) if a]
        if not ids:
            return None
        if len(ids) > CACHE_TERM_MAX_ANIMES:
            return False

        if len(ids) == 1:
            source, status, conf = "cache_extract_1", "approved", 85
        else:
            source, status, conf = "cache_extract_n", "pending", 60

        item = [{"alias": term, "alias_norm": normalize_alias(term),
                 "lang": None, "title_type": "search_keyword"}]
        written = 0
        for aid in ids:
            written += self.upsert_aliases(
                db, aid, item, source=source, status=status,
                confidence=conf, hit_snapshot=hit_count or 0,
            )
        return written

    @staticmethod
    def _query_cache_term_groups(db, min_cache_id: int, limit: int):
        """取「有结果搜索缓存 → 关联 animeId 列表」分组。

        走 cache_key 关联而非解析响应体：响应体在 Redis（storage_mode=redis 时
        SQL 的 response_body 为 NULL），而 api_response_entities 落库时记了
        cache_key，正好是现成的桥梁，无需读 Redis。
        """
        sql = sql_text("""
            SELECT arc.id, arc.cache_key, arc.hit_count,
                   GROUP_CONCAT(DISTINCT are.entity_id) AS anime_ids
            FROM api_response_cache arc
            JOIN api_response_entities are
              ON are.cache_key = arc.cache_key AND are.entity_type = 'anime'
            WHERE arc.api_path LIKE '/api/v2/search/%'
              AND arc.is_empty = 0
              AND arc.id > :min_id
            GROUP BY arc.id, arc.cache_key, arc.hit_count
            ORDER BY arc.id
            LIMIT :lim
        """)
        out = []
        for r in db.execute(sql, {"min_id": min_cache_id, "lim": limit}):
            ids = [s for s in (r[3] or "").split(",") if s]
            out.append((r[0], r[1] or "", r[2] or 0, ids))
        return out


    # ---------- 线上别名解析（阶段 5，Worker 走 cache.get 顺带调用） ----------

    def resolve_search_term(self, db, cache_key: str) -> Optional[Dict[str, Any]]:
        """搜索词未命中时，用 approved 别名给出 dandanplay 能搜到的规范词。

        只查 status=approved：pending 是算法/AI 推断的，未经人工确认不上线。
        同一别名可能挂到多个 animeId（系列名场景），取 confidence 最高的一条。

        返回 None 的三种情况都意味着「Worker 按原词回源即可」：
        - cache_key 里没有搜索词（非搜索类请求）
        - 别名表里没有 approved 记录
        - 找到的规范词归一化后与原词相同（替换没有意义，避免无效重试）
        """
        term = parse_search_term(cache_key)
        if not term:
            return None
        norm = normalize_alias(term)
        if not norm:
            return None

        rows = db.query(MediaAlias).filter(
            MediaAlias.alias_norm == norm,
            MediaAlias.status == "approved",
        ).order_by(MediaAlias.confidence.desc()).limit(5).all()
        if not rows:
            return None

        # 别名只给出 animeId，真正要回给 Worker 的是该番剧的规范标题——
        # 客户端搜的是标题，所以得从媒体库主档取 title 才能重组搜索 URL。
        anime_ids = [r.anime_id for r in rows if r.anime_id]
        if not anime_ids:
            return None
        title_map = {
            m.anime_id: m.title
            for m in db.query(MediaLibrary).filter(
                MediaLibrary.anime_id.in_(anime_ids)
            ).all()
            if m.title
        }
        for r in rows:
            canonical = title_map.get(r.anime_id)
            if not canonical:
                continue
            # 规范词和原词归一化后一致说明替换是空操作，跳过看下一个候选
            if normalize_alias(canonical) == norm:
                continue
            return {
                "alias_hit": True,
                "term": term,
                "canonical": canonical,
                "anime_id": r.anime_id,
                "source": r.source,
                "confidence": r.confidence,
            }
        return None

    # ---------- 以下为后台页面读写用（阶段 4） ----------

    def list_external_ids(self, db, anime_id: str) -> List[Dict[str, Any]]:
        """列出某番剧的所有外部平台 ID，按 provider 字母序稳定输出"""
        rows = db.query(MediaExternalId).filter(
            MediaExternalId.anime_id == anime_id
        ).order_by(MediaExternalId.provider).all()
        return [{
            "id": r.id,
            "provider": r.provider,
            "external_id": r.external_id,
            "external_url": r.external_url,
            "source": r.source,
            "confidence": r.confidence,
        } for r in rows]

    def list_aliases(self, db, anime_id: str) -> List[Dict[str, Any]]:
        """列出某番剧的所有别名。

        排序：approved 在前，同状态内按 confidence 降序——
        人工最关心「哪些已生效」，其次才是待确认的。
        """
        rows = db.query(MediaAlias).filter(
            MediaAlias.anime_id == anime_id
        ).order_by(
            MediaAlias.status,
            MediaAlias.confidence.desc(),
        ).all()
        return [{
            "id": r.id,
            "alias": r.alias,
            "alias_norm": r.alias_norm,
            "lang": r.lang,
            "title_type": r.title_type,
            "source": r.source,
            "status": r.status,
            "confidence": r.confidence,
            "hit_snapshot": r.hit_snapshot,
            "verified_by": r.verified_by,
        } for r in rows]

    def save_external_id(self, db, anime_id: str, provider: str,
                         external_id: Optional[str],
                         external_url: Optional[str]) -> MediaExternalId:
        """人工新增/修改外部 ID。

        一律标 source=manual、confidence=100，后续自动提取不会覆盖
        （upsert_external_ids 遇 manual 直接跳过）。
        """
        prov = (provider or "").strip().lower()
        if not anime_id or not prov:
            raise ValueError("anime_id 与 provider 不能为空")
        row = db.query(MediaExternalId).filter(
            MediaExternalId.anime_id == anime_id,
            MediaExternalId.provider == prov,
        ).first()
        if not row:
            row = MediaExternalId(anime_id=anime_id, provider=prov)
            db.add(row)
        row.external_id = (external_id or "").strip() or None
        row.external_url = (external_url or "").strip() or None
        row.source = "manual"
        row.confidence = 100
        return row

    def save_alias(self, db, anime_id: str, alias: str,
                   lang: Optional[str] = None,
                   title_type: str = "alias",
                   user_id: Optional[int] = None) -> MediaAlias:
        """人工新增别名，直接 approved 生效。

        唯一键是 (alias_norm, anime_id)，同一别名重复提交视为更新。
        """
        text_alias = (alias or "").strip()
        norm = normalize_alias(text_alias)
        if not anime_id or not norm:
            raise ValueError("anime_id 与 alias 不能为空")
        row = db.query(MediaAlias).filter(
            MediaAlias.anime_id == anime_id,
            MediaAlias.alias_norm == norm,
        ).first()
        if not row:
            row = MediaAlias(anime_id=anime_id, alias_norm=norm)
            db.add(row)
        row.alias = text_alias
        row.lang = lang or "unknown"
        row.title_type = title_type or "alias"
        row.source = "manual"
        row.status = "approved"
        row.confidence = 100
        row.verified_by = user_id
        return row

    def review_alias(self, db, alias_id: int, approve: bool,
                     user_id: Optional[int] = None) -> Optional[MediaAlias]:
        """人工审核 pending 别名：通过转 approved，拒绝转 rejected。

        标记 verified_by 后，自动任务不再改动该行（upsert_aliases 会跳过）。
        """
        row = db.query(MediaAlias).filter(MediaAlias.id == alias_id).first()
        if not row:
            return None
        row.status = "approved" if approve else "rejected"
        row.verified_by = user_id
        return row

    def delete_external_id(self, db, row_id: int) -> bool:
        row = db.query(MediaExternalId).filter(
            MediaExternalId.id == row_id).first()
        if not row:
            return False
        db.delete(row)
        return True

    def delete_alias(self, db, row_id: int) -> bool:
        row = db.query(MediaAlias).filter(MediaAlias.id == row_id).first()
        if not row:
            return False
        db.delete(row)
        return True

    # ---------- 空结果词候选生成（阶段 6） ----------

    def generate_candidates(self, db, limit: int = 200,
                            min_hit: int = 1) -> Dict[str, int]:
        """扫空结果负缓存，为搜不到的词找库里的规范标题候选。

        思路：客户端发「无职转生 第三季 ～…～」搜不到，但库里有
        「无职转生Ⅲ ～…～」。剥掉季号拿到基础词「无职转生」去库里模糊匹配，
        再用季号（3 ↔ Ⅲ）从同系列的多个结果里挑对应那一部。

        产出一律 status=pending：算法推断不直接上线，等人工在校验页确认。
        按 hit_count 降序处理——命中越多的词修好收益越大。
        """
        stat = {"scanned": 0, "matched": 0, "no_base": 0,
                "no_candidate": 0, "exists": 0}
        rows = self._query_empty_terms(db, limit, min_hit)

        for cache_key, hit_count in rows:
            stat["scanned"] += 1
            term = parse_search_term(cache_key)
            if not term:
                stat["no_base"] += 1
                continue
            norm = normalize_alias(term)
            # 该词已有别名记录（含之前生成的 pending）就跳过，避免重复刷
            if db.query(MediaAlias).filter(
                    MediaAlias.alias_norm == norm).first():
                stat["exists"] += 1
                continue

            base, season = strip_season(term)
            if not base or len(base) < 2:
                stat["no_base"] += 1
                continue

            picked = self._pick_candidate(db, base, season)
            if not picked:
                stat["no_candidate"] += 1
                continue
            anime_id, confidence = picked
            item = [{"alias": term, "alias_norm": norm,
                     "lang": None, "title_type": "search_keyword"}]
            stat["matched"] += self.upsert_aliases(
                db, anime_id, item, source="auto_match", status="pending",
                confidence=confidence, hit_snapshot=hit_count or 0,
            )
        return stat

    @staticmethod
    def _query_empty_terms(db, limit: int, min_hit: int):
        """取空结果负缓存，按命中降序——先修最热的词"""
        sql = sql_text("""
            SELECT cache_key, hit_count
            FROM api_response_cache
            WHERE is_empty = 1
              AND api_path LIKE '/api/v2/search/%'
              AND hit_count >= :min_hit
            ORDER BY hit_count DESC
            LIMIT :lim
        """)
        return [(r[0] or "", r[1] or 0)
                for r in db.execute(sql, {"min_hit": min_hit, "lim": limit})]

    @staticmethod
    def _pick_candidate(db, base: str, season: Optional[int]):
        """用基础词在媒体库里找同系列条目，按季号对齐挑一个。

        返回 (anime_id, confidence) 或 None。confidence 分档依据：
        - 90：季号精确对上（第三季 ↔ Ⅲ），最可信
        - 75：搜索词没季号、库里也只有一个无季号条目，基本就是它
        - 60：同系列多个条目但季号对不上，取标题最短的（通常是第一季/主条目）
        """
        rows = db.query(MediaLibrary).filter(
            MediaLibrary.title.like(f"%{base}%")
        ).limit(30).all()
        if not rows:
            return None

        scored = []
        for m in rows:
            if not m.title or not m.anime_id:
                continue
            t_season = season_of_title(m.title)
            scored.append((m.anime_id, m.title, t_season))
        if not scored:
            return None

        if season is not None:
            # 季号对齐：库里第一季常不带标记，用 None 视作 1 来匹配
            for aid, _title, t_season in scored:
                if t_season == season or (season == 1 and t_season is None):
                    return aid, 90
        else:
            # 搜索词无季号：优先取库里同样无季号的（主条目）
            plain = [x for x in scored if x[2] is None]
            if len(plain) == 1:
                return plain[0][0], 75
            if plain:
                # 多个无季号条目，取标题最短的——通常是不带副标题的主条目
                plain.sort(key=lambda x: len(x[1]))
                return plain[0][0], 65

        # 兜底：季号对不上，取标题最短的条目，置信度压到 60 交人工判断
        scored.sort(key=lambda x: len(x[1]))
        return scored[0][0], 60

    # ---------- 待校验列表（阶段 7，校验页数据源） ----------

    def list_pending(self, db, status: str = "pending",
                     page: int = 1, page_size: int = 20) -> Dict[str, Any]:
        """跨番剧列出待校验别名，按命中数降序。

        校验页的核心视图：人工只需从上往下点，命中最高的先修，
        按方案 §1.3 的统计，前 50 条就能覆盖 60%+ 的命中量。
        同时带出候选番剧的标题与外部 ID，人工判断时不用再跳页面。
        """
        q = db.query(MediaAlias).filter(MediaAlias.status == status)
        total = q.count()
        rows = q.order_by(
            MediaAlias.hit_snapshot.desc(), MediaAlias.id.desc()
        ).offset((page - 1) * page_size).limit(page_size).all()
        if not rows:
            return {"total": total, "items": []}

        # 批量取候选番剧标题，避免逐行查（N+1）
        anime_ids = [r.anime_id for r in rows if r.anime_id]
        title_map = {}
        if anime_ids:
            title_map = {
                m.anime_id: m.title
                for m in db.query(MediaLibrary).filter(
                    MediaLibrary.anime_id.in_(anime_ids)).all()
            }
        # 批量取 bangumi/tmdb 外链，供人工点开核对
        link_map: Dict[str, Dict[str, str]] = {}
        if anime_ids:
            for e in db.query(MediaExternalId).filter(
                MediaExternalId.anime_id.in_(anime_ids),
                MediaExternalId.provider.in_(("bangumi_tv", "tmdb")),
            ).all():
                link_map.setdefault(e.anime_id, {})[e.provider] = e.external_url

        items = [{
            "id": r.id,
            "alias": r.alias,
            "anime_id": r.anime_id,
            "candidate_title": title_map.get(r.anime_id),
            "source": r.source,
            "status": r.status,
            "confidence": r.confidence,
            "hit_snapshot": r.hit_snapshot,
            "ai_suggestion": r.ai_suggestion,
            "links": link_map.get(r.anime_id) or {},
        } for r in rows]
        return {"total": total, "items": items}


media_meta_service = MediaMetaService()
