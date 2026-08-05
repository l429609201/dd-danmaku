"""本地别名兜底的正式回归测试。"""
import importlib

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.database import Base
from src.models_v2 import ApiResponseEntity, EpisodeLink, MediaAlias, MediaLibrary

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


def test_episode_numbers_are_sorted_numerically(monkeypatch):
    factory, engine = _session_factory()
    session = factory()
    media, first = _media("9", "排序测试", "2020-01-01", "90001")
    session.add_all([media, first, EpisodeLink(
        id=90023, local_title="排序测试 第23集", episode_number="23",
        episode_title="第23集", dandan_anime_id="9", dandan_episode_id="90023",
        anime_title="排序测试", match_source="search_episodes",
        source_cache_key="cache-9",
    ), EpisodeLink(
        id=90901, local_title="排序测试 特别篇", episode_number="S1",
        episode_title="S1 特别篇", dandan_anime_id="9", dandan_episode_id="90901",
        anime_title="排序测试", match_source="search_episodes",
        source_cache_key="cache-9",
    ), MediaAlias(
        id=9, anime_id="9", alias="排序测试", alias_norm="排序测试",
        alias_norm_ns="排序测试", source="manual", status="approved", confidence=100,
    )])
    session.commit()
    session.close()
    monkeypatch.setattr(alias_module, "get_db_sync", factory)

    result = alias_module.alias_external_service.search_by_keyword("排序测试")

    titles = [ep["episodeTitle"] for ep in result["animes"][0]["episodes"]]
    assert titles == ["第1集", "第23集", "S1 特别篇"]
    engine.dispose()


def test_episode_link_title_is_used_when_library_title_missing(monkeypatch):
    factory, engine = _session_factory()
    session = factory()
    media, episode = _media("10", "分集标题兜底", "2020-01-01", "100001")
    media.title = None
    session.add_all([media, episode, MediaAlias(
        id=10, anime_id="10", alias="标题兜底", alias_norm="标题兜底",
        alias_norm_ns="标题兜底", source="manual", status="approved", confidence=100,
    )])
    session.commit()
    session.close()
    monkeypatch.setattr(alias_module, "get_db_sync", factory)

    result = alias_module.alias_external_service.search_by_keyword("标题兜底")

    assert result["animes"][0]["animeTitle"] == "分集标题兜底"
    engine.dispose()


def test_partial_entities_only_fill_missing_episode_links(monkeypatch):
    factory, engine = _session_factory()
    session = factory()
    media, first = _media("11", "部分实体测试", "2020-01-01", "110001")
    session.add_all([media, first, EpisodeLink(
        id=110002, local_title="部分实体测试 第2集", episode_number="2",
        episode_title="链接第2集", dandan_anime_id="11", dandan_episode_id="110002",
        anime_title="部分实体测试", match_source="manual",
        source_cache_key="cache-11", is_manual=True,
    ), ApiResponseEntity(
        id=111, entity_type="episode", entity_id="110002", anime_id="11",
        episode_number="2", episode_title="实体第2集", api_path="/episodes",
        cache_key="entity-11-2", raw_json={"episodeId": 110002, "episodeTitle": "实体第2集"},
    ), ApiResponseEntity(
        id=112, entity_type="episode", entity_id="110003", anime_id="11",
        episode_number="3", episode_title="实体第3集", api_path="/episodes",
        cache_key="entity-11-3", raw_json={"episodeId": 110003, "episodeTitle": "实体第3集"},
    ), MediaAlias(
        id=11, anime_id="11", alias="部分实体测试", alias_norm="部分实体测试",
        alias_norm_ns="部分实体测试", source="manual", status="approved", confidence=100,
    )])
    session.commit()
    session.close()
    monkeypatch.setattr(alias_module, "get_db_sync", factory)

    result = alias_module.alias_external_service.search_by_keyword("部分实体测试")

    episodes = result["animes"][0]["episodes"]
    assert set(result["animes"][0]) == {
        "animeId", "animeTitle", "type", "typeDescription", "episodes",
    }
    assert [item["episodeId"] for item in episodes] == [110001, 110002, 110003]
    assert [item["episodeTitle"] for item in episodes] == [
        "第1集", "链接第2集", "实体第3集",
    ]
    engine.dispose()