"""
别名匹配的 AI 辅助服务。

定位：**只给 pending 候选打分供人工参考，不自动上线**。
AI 返回的建议写进 media_alias.ai_suggestion，校验页展示给人看，
人工点确认后才 approved。唯一的例外也需要单独开关，默认关闭。

为什么不自动采信：算法置信度低的本来就是难判断的（多季同名、
系列副标题差异），AI 在这类场景同样会错，错了会直接污染线上搜索。
人工看一眼的成本远低于错误映射的代价。

接口用 OpenAI 兼容格式（/chat/completions），
所以 OpenAI / DeepSeek / 通义 / 本地 vLLM 都能直接接，不锁厂商。
"""
import json
import logging
from typing import Any, Dict, List, Optional

import httpx

from src.database import get_db_sync
from src.models_v2 import AppSetting, MediaAlias, MediaLibrary
from src.models_v2.base import now
from src.services_v2.media_meta_service import (
    normalize_alias, strip_season,
)

logger = logging.getLogger(__name__)

# 提示词刻意要求只输出 JSON：便于稳定解析，
# 也避免模型长篇解释浪费 token（按量计费）。
PROMPT_TEMPLATE = """用户在弹幕站搜索「{term}」但没有搜到结果（该词被请求了 {hit} 次）。
下面是弹幕站库内的候选番剧标题，请判断哪一个最可能是用户想找的。

候选：
{candidates}

判断要点：
- 季号写法差异很常见：「第三季」对应「Ⅲ」或「III」或「3」
- 「篇」「章」「剧场版」多是同一作品的分部，不一定是不同季
- 若都不匹配，match_index 返回 0

只输出 JSON，不要解释：
{{"match_index": 数字, "confidence": 0-100, "reason": "简短中文理由"}}"""


class AliasAiService:
    """AI 辅助别名匹配（OpenAI 兼容接口）"""

    async def score_pending(self, max_calls: Optional[int] = None) -> Dict[str, int]:
        """给低置信度 pending 候选逐条打分，结果写 ai_suggestion。

        只处理算法置信度低于阈值的——高置信度的不值得花钱。
        按 hit_snapshot 降序：命中越多的词修好收益越大。
        """
        import asyncio
        cfg = await asyncio.to_thread(self._load_config)
        if not cfg["enabled"] or not cfg["api_key"]:
            return {"enabled": 0}

        limit = max_calls if max_calls is not None else cfg["max_calls"]
        rows = await asyncio.to_thread(self._load_targets, cfg["skip_confidence"], limit)
        if not rows:
            return {"enabled": 1, "scored": 0, "no_target": 1}

        stat = {"enabled": 1, "scored": 0, "failed": 0, "skipped": 0}
        for item in rows:
            cands = await asyncio.to_thread(self._load_candidates, item["alias"])
            if not cands:
                stat["skipped"] += 1
                continue
            try:
                suggestion = await self._ask(cfg, item, cands)
            except Exception as ex:
                stat["failed"] += 1
                logger.warning(f"⚠️ AI 打分失败 alias_id={item['id']}: {ex}")
                continue
            if not suggestion:
                stat["failed"] += 1
                continue
            await asyncio.to_thread(self._save_suggestion, item["id"], suggestion)
            stat["scored"] += 1
        logger.info(f"🤖 AI 别名打分完成: {stat}")
        return stat

    async def _ask(self, cfg: dict, item: dict,
                   cands: List[Dict[str, Any]]) -> Optional[dict]:
        """调一次模型，返回解析后的建议 dict"""
        lines = "\n".join(
            f"{i + 1}. {c['title']}（animeId={c['anime_id']}）"
            for i, c in enumerate(cands)
        )
        prompt = PROMPT_TEMPLATE.format(
            term=item["alias"], hit=item["hit_snapshot"], candidates=lines)

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{cfg['base_url'].rstrip('/')}/chat/completions",
                headers={
                    "Authorization": f"Bearer {cfg['api_key']}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": cfg["model"],
                    "messages": [{"role": "user", "content": prompt}],
                    # 温度 0：同一输入要给同一答案，便于复现与排查
                    "temperature": 0,
                    "max_tokens": 200,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
        parsed = self._parse_json(content)
        if not parsed:
            return None
        idx = parsed.get("match_index")
        if not isinstance(idx, int) or idx < 1 or idx > len(cands):
            # 0 或越界都表示模型认为无匹配，记下来避免下轮重复问
            return {"match_index": 0, "confidence": 0,
                    "reason": parsed.get("reason") or "AI 判断无匹配",
                    "model": cfg["model"]}
        picked = cands[idx - 1]
        return {
            "match_index": idx,
            "anime_id": picked["anime_id"],
            "title": picked["title"],
            "confidence": int(parsed.get("confidence") or 0),
            "reason": str(parsed.get("reason") or "")[:200],
            "model": cfg["model"],
        }

    @staticmethod
    def _parse_json(content: str) -> Optional[dict]:
        """从模型回复里抠出 JSON。

        即便提示词说了只输出 JSON，模型仍可能包上 ```json 代码块或前后加话，
        所以按最外层大括号截取而非直接 json.loads。
        """
        if not content:
            return None
        s = content.strip()
        start, end = s.find("{"), s.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            return json.loads(s[start:end + 1])
        except Exception:
            return None

    # ---------- DB 读写（同步，由调用方放线程池） ----------

    @staticmethod
    def _load_targets(skip_confidence: int, limit: int) -> List[Dict[str, Any]]:
        """取待打分的 pending：置信度低于阈值、且还没问过 AI 的"""
        db = get_db_sync()
        try:
            rows = db.query(MediaAlias).filter(
                MediaAlias.status == "pending",
                MediaAlias.confidence < skip_confidence,
                MediaAlias.ai_called_at.is_(None),
            ).order_by(MediaAlias.hit_snapshot.desc()).limit(limit).all()
            return [{"id": r.id, "alias": r.alias,
                     "hit_snapshot": r.hit_snapshot or 0} for r in rows]
        finally:
            db.close()

    @staticmethod
    def _load_candidates(alias: str, limit: int = 8) -> List[Dict[str, Any]]:
        """用基础词在媒体库里捞同系列条目作为候选给 AI 选"""
        base, _season = strip_season(alias)
        if not base or len(base) < 2:
            return []
        db = get_db_sync()
        try:
            rows = db.query(MediaLibrary).filter(
                MediaLibrary.title.like(f"%{base}%")
            ).limit(limit).all()
            return [{"anime_id": m.anime_id, "title": m.title}
                    for m in rows if m.title and m.anime_id]
        finally:
            db.close()

    @staticmethod
    def _save_suggestion(alias_id: int, suggestion: dict):
        """写回 AI 建议。只写 ai_suggestion / ai_called_at，
        不动 status / confidence——上线与否由人工决定。"""
        db = get_db_sync()
        try:
            row = db.query(MediaAlias).filter(MediaAlias.id == alias_id).first()
            if not row:
                return
            row.ai_suggestion = suggestion
            row.ai_called_at = now()
            db.commit()
        finally:
            db.close()

    @staticmethod
    def _load_config() -> dict:
        """一次性读全部 AI 配置，避免逐项查库"""
        keys = ("alias_ai_enabled", "alias_ai_base_url", "alias_ai_api_key",
                "alias_ai_model", "alias_ai_max_calls_per_run",
                "alias_ai_skip_confidence")
        db = get_db_sync()
        try:
            got = {r.key: r.value for r in db.query(AppSetting).filter(
                AppSetting.key.in_(keys)).all()}
        finally:
            db.close()

        def _b(k, d):
            v = got.get(k)
            return d if v in (None, "") else str(v).lower() in ("1", "true", "yes", "on")

        def _i(k, d):
            try:
                v = got.get(k)
                return int(v) if v not in (None, "") else d
            except Exception:
                return d
        return {
            "enabled": _b("alias_ai_enabled", False),
            "base_url": got.get("alias_ai_base_url") or "https://api.openai.com/v1",
            "api_key": got.get("alias_ai_api_key") or "",
            "model": got.get("alias_ai_model") or "gpt-4o-mini",
            "max_calls": _i("alias_ai_max_calls_per_run", 50),
            "skip_confidence": _i("alias_ai_skip_confidence", 80),
        }


alias_ai_service = AliasAiService()
