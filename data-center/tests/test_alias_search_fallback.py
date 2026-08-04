import importlib
import os
import tempfile
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.models_v2 import EpisodeLink, MediaAlias, MediaLibrary
from src.models_v2.base import Base


class AliasSearchFallbackTest(unittest.TestCase):
    """本地 429 兜底必须正确区分明确季度与裸系列词。"""

    @classmethod
    def setUpClass(cls):
        cls.db_path = os.path.join(tempfile.gettempdir(), "alias_search_fallback.db")
        if os.path.exists(cls.db_path):
            os.remove(cls.db_path)
        cls.engine = create_engine(f"sqlite:///{cls.db_path}")
        Base.metadata.create_all(cls.engine)
        cls.session_factory = sessionmaker(bind=cls.engine)
        cls._seed()

        cls.module = importlib.import_module(
            "src.services_v2.alias_external_service")
        cls.original_get_db = cls.module.get_db_sync
        cls.module.get_db_sync = lambda: cls.session_factory()

    @classmethod
    def tearDownClass(cls):
        cls.module.get_db_sync = cls.original_get_db
        cls.engine.dispose()
        if os.path.exists(cls.db_path):
            os.remove(cls.db_path)

    @classmethod
    def _seed(cls):
        db = cls.session_factory()
        seasons = [
            ("10816", "OVERLORD"),
            ("12952", "OVERLORD II"),
            ("14008", "OVERLORD III"),
            ("16296", "OVERLORD IV"),
        ]
        alias_id = 1
        link_id = 1
        for media_id, (anime_id, title) in enumerate(seasons, 1):
            db.add(MediaLibrary(
                id=media_id, anime_id=anime_id, title=title,
                type_code="tvseries", type_desc="TV动画",
                episode_count=13, source="test"))
            db.add(MediaAlias(
                id=alias_id, anime_id=anime_id, alias=title,
                alias_norm=title.lower(),
                alias_norm_ns=title.lower().replace(" ", ""),
                status="approved", confidence=95, source="test"))
            alias_id += 1
            for episode in range(1, 14):
                db.add(EpisodeLink(
                    id=link_id, local_title=f"{title} {episode}",
                    episode_number=str(episode), episode_title=f"第{episode}话",
                    dandan_anime_id=anime_id,
                    dandan_episode_id=f"{anime_id}{episode:04d}",
                    anime_title=title, match_source="test",
                    source_cache_key=f"k{anime_id}{episode}", confidence=100))
                link_id += 1
        # 复刻现网脏数据：第二季错误拥有裸词别名，不应导致只返回第二季。
        db.add(MediaAlias(
            id=alias_id, anime_id="12952", alias="overlord",
            alias_norm="overlord", alias_norm_ns="overlord",
            status="approved", confidence=95, source="test"))
        db.commit()
        db.close()

    def _titles(self, keyword):
        result = self.module.alias_external_service.search_by_keyword(keyword)
        self.assertTrue(all(len(item["episodes"]) == 13 for item in result["animes"]))
        return [item["animeTitle"] for item in result["animes"]]

    def test_bare_keyword_returns_all_tv_seasons_in_order(self):
        self.assertEqual(self._titles("OVERLORD"), [
            "OVERLORD", "OVERLORD II", "OVERLORD III", "OVERLORD IV"])

    def test_roman_first_season_returns_unmarked_title(self):
        self.assertEqual(self._titles("OVERLORD I"), ["OVERLORD"])

    def test_explicit_fourth_season_returns_only_fourth(self):
        self.assertEqual(self._titles("OVERLORD IV"), ["OVERLORD IV"])
        self.assertEqual(self._titles("overlord 第四季"), ["OVERLORD IV"])


if __name__ == "__main__":
    unittest.main()
