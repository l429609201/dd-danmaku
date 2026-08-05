"""本地别名兜底的正式回归测试。"""
import importlib

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.database import Base
from src.models_v2 import EpisodeLink, MediaAlias, MediaLibrary

alias_module = importlib.import_module("src.services_v2.alias_external_service")


def _session_factory():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine), engine


def _media(anime_id, title, start_date, episode_id):
    return (
        MediaLibrary(
            id=int(anime_id), anime_id=str(anime_id), title=title,
            type_code="tvseries", type_desc="TV动画", start_date=start_date,
            episode_count=1, source="search_anime",
        ),
        EpisodeLink(
            id=int(episode_id), local_title=f"{title} 第1集", episode_number="1",
            episode_title="第1集", dandan_anime_id=str(anime_id),
            dandan_episode_id=str(episode_id), anime_title=title,
            match_source="search_episodes", source_cache_key=f"cache-{anime_id}",
        ),
    )


def _seed(session):
    rows = [
        _media("1", "OVERLORD", "2015-07-07", "10001"),
        _media("2", "OVERLORD II", "2018-01-09", "20001"),
        _media("3", "OVERLORD III", "2018-07-10", "30001"),
        _media("4", "OVERLORD IV", "2022-07-05", "40001"),
    ]
    for media, episode in rows:
        session.add_all([media, episode])
    session.add_all([
        MediaAlias(
            id=1, anime_id="4", alias="overlord 第四季",
            alias_norm="overlord 第四季", alias_norm_ns="overlord第四季",
            source="manual", status="approved", confidence=100,
        ),
        MediaAlias(
            id=2, anime_id="3", alias="未审核别名",
            alias_norm="未审核别名", alias_norm_ns="未审核别名",
            source="auto_match", status="pending", confidence=100,
        ),
    ])
    session.commit()


def test_bare_series_returns_all_seasons_in_release_order(monkeypatch):
    factory, engine = _session_factory()
    session = factory()
    _seed(session)
    session.close()
    monkeypatch.setattr(alias_module, "get_db_sync", factory)

    result = alias_module.alias_external_service.search_by_keyword("OVERLORD")

    assert [item["animeId"] for item in result["animes"]] == [1, 2, 3, 4]
    assert all(len(item["episodes"]) == 1 for item in result["animes"])
    engine.dispose()


def test_roman_or_chinese_season_returns_only_requested_season(monkeypatch):
    factory, engine = _session_factory()
    session = factory()
    _seed(session)
    session.close()
    monkeypatch.setattr(alias_module, "get_db_sync", factory)

    roman = alias_module.alias_external_service.search_by_keyword("OVERLORD IV")
    chinese = alias_module.alias_external_service.search_by_keyword("overlord 第四季")

    assert [item["animeId"] for item in roman["animes"]] == [4]
    assert [item["animeId"] for item in chinese["animes"]] == [4]
    engine.dispose()


def test_pending_alias_never_becomes_online_result(monkeypatch):
    factory, engine = _session_factory()
    session = factory()
    _seed(session)
    session.close()
    monkeypatch.setattr(alias_module, "get_db_sync", factory)

    result = alias_module.alias_external_service.search_by_keyword("未审核别名")

    assert result == {"animes": []}
    engine.dispose()
