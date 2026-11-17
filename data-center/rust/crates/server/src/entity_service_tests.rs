//! 独立实体回归测试：只使用内存 SQLite，不读取真实配置或生产库。
use super::*;
use sea_orm::{Database, DbBackend, Statement};
use db::entities::api_response_entity as raw_entity;

async fn service() -> EntityService {
    let db = Database::connect("sqlite::memory:").await.unwrap();
    db::test_helper::create_test_schema(&db).await.unwrap();
    EntityService::new(db)
}

fn fixture(id: i64, title: &str, count: i32) -> Value {
    json!({"bangumi":{"animeId":id,"animeTitle":title,"type":"tvseries","episodeCount":count,
        "imageUrl":"https://example.org/cover.jpg","typeDescription":"TV动画","summary":"作品简介",
        "rating":8.5,"startDate":"2026-01-01","seasonNumber":2,
        "futureAnimeField":{"nested":true},"titles":[{"title":"Ｆｏｏ 别名","language":"官方标题，简体中文"}],
        "onlineDatabases":[{"name":"IMDb","url":"https://www.imdb.com/title/tt1234567/"}],
        "episodes":[{"episodeId":format!("{id}0010"),"episodeNumber":"10","episodeTitle":"十","typeDescription":"正片","durationSeconds":1440,"airDate":"2026-01-01","futureEpisodeField":[1,2]},
                    {"episodeId":format!("{id}0002"),"episodeNumber":"2","episodeTitle":"二"}]}})
}

async fn ingest(service: &EntityService, data: Value) {
    service.ingest("GET:/api/v2/bangumi/800", "/api/v2/bangumi/800", &data.to_string()).await.unwrap();
}

fn assembled_body(value: Value) -> Value {
    serde_json::from_str(value["body"].as_str().unwrap()).unwrap()
}

#[tokio::test]
async fn keyword_precedence_and_already_decoded_titles_match_http_contract() {
    let service = service().await;
    ingest(&service, fixture(810, "甲", 2)).await;
    assert!(service.assemble("GET:/api/v2/search/anime?anime=甲&keyword=乙").await.unwrap().is_none());
    assert!(service.resolve_search_term("GET:/api/v2/search/anime?anime=甲&keyword=乙").await.unwrap().is_none());
    ingest(&service, fixture(811, "C++ %20", 2)).await;
    let result = service.assemble("GET:/api/v2/search/anime?keyword=C++ %20").await.unwrap().unwrap();
    assert_eq!(assembled_body(result)["animes"][0]["animeTitle"], "C++ %20");
    // 本地字段不能解释未知查询参数，必须保留回源机会。
    assert!(service.assemble("GET:/api/v2/search/anime?keyword=甲&unknown=1").await.unwrap().is_none());
    assert!(service.assemble("GET:/api/v2/search/episodes?anime=甲&unknown=1").await.unwrap().is_none());
    assert!(service.resolve_search_term("GET:/api/v2/search/anime?keyword=甲&unknown=1").await.unwrap().is_none());
}

#[tokio::test]
async fn ingest_assemble_uses_normalized_fields_upstream_ids_and_numeric_order() {
    let service = service().await;
    ingest(&service, fixture(800,"测试作品",2)).await;
    let result = service.assemble("GET:/api/v2/search/episodes?anime=测试作品").await.unwrap().unwrap();
    assert_eq!(result["mode"], "episodes_season");
    let body = assembled_body(result);
    assert_eq!(body["animes"][0]["animeId"],800);
    assert_eq!(body["animes"][0]["imageUrl"], "https://example.org/cover.jpg");
    assert_eq!(body["animes"][0]["typeDescription"], "TV动画");
    assert_eq!(body["animes"][0]["summary"], "作品简介");
    assert_eq!(body["animes"][0]["rating"], 8.5);
    assert_eq!(body["animes"][0]["startDate"], "2026-01-01");
    let detail = assembled_body(service.assemble_bangumi("800").await.unwrap().unwrap());
    assert_eq!(detail["bangumi"]["seasonNumber"], 2);
    assert_eq!(detail["bangumi"]["summary"], "作品简介");
    assert!(body["animes"][0].get("futureAnimeField").is_none());
    assert_eq!(body["animes"][0]["episodes"][0]["episodeNumber"],"2");
    let ep = &body["animes"][0]["episodes"][1];
    assert_eq!(ep["episodeId"], 8000010);
    assert_eq!(ep["typeDescription"], "正片");
    assert_eq!(ep["durationSeconds"], 1440);
    assert_eq!(ep["airDate"], "2026-01-01");
    assert!(ep.get("futureEpisodeField").is_none());
    assert!(raw_entity::Entity::find().all(&service.db).await.unwrap().is_empty());
    assert!(season::Entity::find().all(&service.db).await.unwrap().iter().all(|s| s.raw_entity_id.is_none()));
    let main=anime::Entity::find().one(&service.db).await.unwrap().unwrap();
    assert_ne!(main.id,800);
    assert_eq!(episode::Entity::find().all(&service.db).await.unwrap()[0].anime_id,main.id);
    let external=anime_external_id::Entity::find().one(&service.db).await.unwrap().unwrap();
    assert_eq!(external.external_id.as_deref(),Some("tt1234567"));
    assert_eq!(external.anime_id,main.id);
    let search=assembled_body(service.assemble("GET:/api/v2/search/anime?keyword=测试作品").await.unwrap().unwrap());
    assert!(search["animes"][0].get("episodes").is_none());
}

#[tokio::test]
async fn incomplete_or_undeclared_season_does_not_assemble_but_single_episode_does() {
    let service=service().await;
    ingest(&service,fixture(801,"未完作品",12)).await;
    assert!(service.assemble("GET:/api/v2/search/episodes?anime=未完作品").await.unwrap().is_none());
    let single=assembled_body(service.assemble("GET:/api/v2/search/episodes?anime=未完作品&episode=10").await.unwrap().unwrap());
    assert_eq!(single["animes"][0]["episodes"].as_array().unwrap().len(),1);
    let mut value=fixture(802,"未知集数",0);
    value["bangumi"].as_object_mut().unwrap().remove("episodeCount");
    ingest(&service,value).await;
    assert!(service.assemble("GET:/api/v2/search/episodes?anime=未知集数").await.unwrap().is_none());
}

#[tokio::test]
async fn approved_alias_nfkc_and_manual_links_override_normalized_fields() {
    let service=service().await;
    ingest(&service,fixture(803,"正名作品",2)).await;
    let alias=service.alias_query("foo别名").await.unwrap();
    assert_eq!(alias["success"],true);
    assert_eq!(alias["data"][0]["animeId"],803);
    let rewrite=service.resolve_search_term("GET:/api/v2/search/episodes?anime=Ｆｏｏ 别名").await.unwrap().unwrap();
    assert_eq!(rewrite["canonical"],"正名作品");
    assert_eq!(rewrite["anime_id"],"803");
    let main=anime::Entity::find().filter(anime::Column::UpstreamAnimeId.eq("803")).one(&service.db).await.unwrap().unwrap();
    upsert_alias(&service.db,main.id,"待审词",None,"alias","auto_match","pending",60).await.unwrap();
    assert_eq!(service.alias_query("待审词").await.unwrap()["success"],false);
    assert!(service.resolve_search_term("GET:/api/v2/search/episodes?anime=待审词").await.unwrap().is_none());
    let mut link=episode_link::Entity::find().filter(episode_link::Column::DandanEpisodeId.eq("8030010")).one(&service.db).await.unwrap().unwrap().into_active_model();
    link.is_manual=Set(true);link.episode_title=Set(Some("人工修正".into()));
    link.update(&service.db).await.unwrap();
    ingest(&service,fixture(803,"正名作品",2)).await;
    let alias=service.alias_query("foo别名").await.unwrap();
    assert_eq!(alias["data"][0]["episodes"][1]["episodeTitle"],"人工修正");
    assert_eq!(alias["data"][0]["episodes"][1]["durationSeconds"],1440);
    let search = assembled_body(service.assemble("GET:/api/v2/search/episodes?anime=正名作品&episode=10").await.unwrap().unwrap());
    assert_eq!(search["animes"][0]["episodes"][0]["episodeTitle"], "人工修正");
    let rebuilt: Value = serde_json::from_str(&service.reconstruct_ingested(
        "GET:/api/v2/bangumi/803", "/api/v2/bangumi/803", &fixture(803,"正名作品",2).to_string())
        .await.unwrap().unwrap()).unwrap();
    assert_eq!(rebuilt["bangumi"]["episodes"][0]["episodeTitle"], "人工修正");
}

#[tokio::test]
async fn series_override_expands_multiple_seasons_and_rejects_single_high_season() {
    let service=service().await;
    ingest(&service,fixture(810,"多季测试",2)).await;
    ingest(&service,fixture(811,"多季测试 第二季",2)).await;
    let alias=service.alias_query("多季测试").await.unwrap();
    assert_eq!(alias["data"].as_array().unwrap().len(),2);
    let cached=json!({"animes":[{"animeId":810,"animeTitle":"多季测试"}]}).to_string();
    let overridden=assembled_body(service.series_override("GET:/api/v2/search/episodes?anime=多季测试",&cached).await.unwrap().unwrap());
    assert_eq!(overridden["animes"].as_array().unwrap().len(),2);
    assert!(service.series_override("GET:/api/v2/search/episodes?anime=多季测试&episode=2",&cached).await.unwrap().is_none());
    let wrong=json!({"animes":[{"animeId":900,"animeTitle":"孤立系列 第二季"}]}).to_string();
    let rejected=assembled_body(service.series_override("GET:/api/v2/search/episodes?anime=孤立系列",&wrong).await.unwrap().unwrap());
    assert!(rejected["animes"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn normalized_records_work_without_raw_table_and_field_updates_are_immediate() {
    let service = service().await;
    // 删除旧索引表后仍可摄取和查询，确保业务路径没有隐式原始响应依赖。
    service.db.execute(Statement::from_string(DbBackend::Sqlite, "DROP TABLE api_response_entities")).await.unwrap();
    ingest(&service, fixture(820, "结构化作品", 2)).await;
    let mut main = anime::Entity::find().one(&service.db).await.unwrap().unwrap().into_active_model();
    main.type_description = Set(Some("结构化分类".into()));
    main.update(&service.db).await.unwrap();
    let mut ep = episode::Entity::find().filter(episode::Column::UpstreamEpisodeId.eq("8200010"))
        .one(&service.db).await.unwrap().unwrap().into_active_model();
    ep.title = Set(Some("集表修正".into()));
    ep.duration_seconds = Set(Some(123));
    ep.episode_number = Set(Some("11".into()));
    ep.update(&service.db).await.unwrap();
    let body = assembled_body(service.assemble("GET:/api/v2/search/episodes?anime=结构化作品&episode=11").await.unwrap().unwrap());
    assert_eq!(body["animes"][0]["typeDescription"], "结构化分类");
    assert_eq!(body["animes"][0]["episodes"][0]["episodeTitle"], "集表修正");
    assert_eq!(body["animes"][0]["episodes"][0]["durationSeconds"], 123);
    let detail = assembled_body(service.assemble_bangumi("820").await.unwrap().unwrap());
    assert_eq!(detail["bangumi"]["episodes"][0]["episodeNumber"], "11");
    assert_eq!(detail["bangumi"]["onlineDatabases"][0]["name"], "IMDb");
    assert!(detail["bangumi"]["titles"].as_array().unwrap().iter().any(|t| t["title"] == "Ｆｏｏ 别名"));
    assert_eq!(assembled_body(service.assemble("GET:/api/v2/bangumi/820").await.unwrap().unwrap()), detail);
    assert!(service.assemble("GET:/api/v2/bangumi/820?unknown=1").await.unwrap().is_none());
    assert!(service.assemble_bangumi("missing").await.unwrap().is_none());
}

#[tokio::test]
async fn structured_records_assemble_without_ingestion_or_response_snapshots() {
    let service = service().await;
    // 直接建立业务记录，不经摄取和缓存，证明字段本身足以独立响应。
    service.db.execute(Statement::from_string(DbBackend::Sqlite, "DROP TABLE api_response_entities")).await.unwrap();
    let now = Utc::now().naive_utc();
    let main = anime::ActiveModel {
        upstream_anime_id: Set("external-anime".into()), title: Set(Some("独立主档".into())),
        image_url: Set(Some("https://example.org/poster.jpg".into())), type_code: Set(Some("tvseries".into())),
        type_description: Set(Some("TV动画".into())), summary: Set(Some("主档简介".into())),
        rating: Set(Some("8.5".into())), start_date: Set(Some("2026-01-02".into())),
        episode_count: Set(1), source: Set("manual".into()), first_seen_at: Set(now),
        last_seen_at: Set(now), created_at: Set(now), updated_at: Set(now), ..Default::default()
    }.insert(&service.db).await.unwrap();
    let version = season::ActiveModel {
        anime_id: Set(main.id), upstream_bangumi_id: Set(Some("external-season".into())),
        title: Set(Some("独立季".into())), season_number: Set(Some(3)), summary: Set(Some("季简介".into())),
        created_at: Set(now), updated_at: Set(now), ..Default::default()
    }.insert(&service.db).await.unwrap();
    episode::ActiveModel {
        anime_id: Set(main.id), season_id: Set(Some(version.id)), upstream_episode_id: Set("external-episode".into()),
        episode_number: Set(Some("SP1".into())), title: Set(Some("独立集".into())),
        type_description: Set(Some("特别篇".into())), duration_seconds: Set(Some(900)),
        air_date: Set(Some("2026-01-03".into())), source_cache_key: Set("manual".into()),
        first_seen_at: Set(now), last_seen_at: Set(now), created_at: Set(now), updated_at: Set(now), ..Default::default()
    }.insert(&service.db).await.unwrap();
    upsert_alias(&service.db, main.id, "独立别名", Some("ja".into()), "official", "manual", "approved", 100).await.unwrap();
    anime_external_id::ActiveModel {
        anime_id: Set(main.id), provider: Set("bangumi_tv".into()), external_id: Set(Some("123".into())),
        external_url: Set(Some("https://bangumi.tv/subject/123".into())), source: Set("manual".into()),
        confidence: Set(100), created_at: Set(now), updated_at: Set(now), ..Default::default()
    }.insert(&service.db).await.unwrap();
    let search = assembled_body(service.assemble("GET:/api/v2/search/episodes?anime=独立主档").await.unwrap().unwrap());
    let item = &search["animes"][0];
    assert_eq!(item["animeId"], "external-anime");
    assert_eq!(item["imageUrl"], "https://example.org/poster.jpg");
    assert_eq!(item["type"], "tvseries");
    assert_eq!(item["typeDescription"], "TV动画");
    assert_eq!(item["summary"], "主档简介");
    assert_eq!(item["rating"], 8.5);
    assert_eq!(item["startDate"], "2026-01-02");
    assert_eq!(item["episodeCount"], 1);
    assert_eq!(item["episodes"][0], json!({"episodeId":"external-episode", "episodeNumber":"SP1",
        "episodeTitle":"独立集", "typeDescription":"特别篇", "durationSeconds":900, "airDate":"2026-01-03"}));
    bangumi_version::ActiveModel {upstream_bangumi_id:Set("external-season".into()),anime_id:Set(main.id),expected_episode_count:Set(1)}.insert(&service.db).await.unwrap();
    bangumi_episode_member::ActiveModel {upstream_bangumi_id:Set("external-season".into()),ordinal:Set(0),upstream_episode_id:Set("external-episode".into()),upstream_season_id:Set(None),last_watched:Set(None)}.insert(&service.db).await.unwrap();
    bangumi_title::ActiveModel {upstream_bangumi_id:Set("external-season".into()),ordinal:Set(0),title:Set(Some("独立别名".into())),language:Set(Some("官方标题，日语".into()))}.insert(&service.db).await.unwrap();
    let detail = assembled_body(service.assemble_bangumi("external-season").await.unwrap().unwrap());
    assert_eq!(detail["bangumi"]["bangumiId"], "external-season");
    assert_eq!(detail["bangumi"]["animeTitle"], "独立主档");
    assert_eq!(detail["bangumi"]["summary"], "主档简介");
    assert_eq!(detail["bangumi"]["seasonNumber"], 3);
    assert_eq!(detail["bangumi"]["titles"][0], json!({"title":"独立别名", "language":"官方标题，日语"}));
    assert_eq!(detail["bangumi"]["bangumiUrl"], "https://bangumi.tv/subject/123");
    assert_eq!(detail["bangumi"]["episodes"][0]["episodeTitle"], item["episodes"][0]["episodeTitle"]);
    assert!(detail["bangumi"]["episodes"][0]["seasonId"].is_null());
    // 季、别名和外部链接的独立字段编辑应立即反映，不需要重摄取。
    let mut version = version.into_active_model();
    version.summary = Set(Some("编辑后季简介".into()));
    version.update(&service.db).await.unwrap();
    let mut title = bangumi_title::Entity::find().one(&service.db).await.unwrap().unwrap().into_active_model();
    title.title = Set(Some("编辑后别名".into()));
    title.update(&service.db).await.unwrap();
    let mut external = anime_external_id::Entity::find().one(&service.db).await.unwrap().unwrap().into_active_model();
    external.external_url = Set(Some("https://bangumi.tv/subject/456".into()));
    external.update(&service.db).await.unwrap();
    let edited = assembled_body(service.assemble_bangumi("external-season").await.unwrap().unwrap());
    assert_eq!(edited["bangumi"]["summary"], "主档简介");
    assert_eq!(edited["bangumi"]["titles"][0]["title"], "编辑后别名");
    assert_eq!(edited["bangumi"]["bangumiUrl"], "https://bangumi.tv/subject/456");
}

#[tokio::test]
async fn reconstruct_ingested_uses_only_candidate_identity_and_order_from_body() {
    let service = service().await;
    let original = fixture(825, "回源主档", 12);
    ingest(&service, original.clone()).await;
    let mut main = anime::Entity::find().one(&service.db).await.unwrap().unwrap().into_active_model();
    main.type_description = Set(Some("编辑分类".into()));
    main.update(&service.db).await.unwrap();
    let mut ep = episode::Entity::find().filter(episode::Column::UpstreamEpisodeId.eq("8250010"))
        .one(&service.db).await.unwrap().unwrap().into_active_model();
    ep.title = Set(Some("字段集名".into()));
    ep.update(&service.db).await.unwrap();
    // 故意使用与主标题不精确匹配的搜索，且总集数未齐；普通整季缓存不得命中。
    assert!(service.assemble("GET:/api/v2/search/episodes?anime=回源").await.unwrap().is_none());
    let candidate = json!({"animes":[{"animeId":825,"animeTitle":"不可信旧名","futureAnimeField":true,
        "episodes":[{"episodeId":"8250010","episodeTitle":"不可信旧集名"}]}]});
    let search: Value = serde_json::from_str(&service.reconstruct_ingested(
        "GET:/api/v2/search/episodes?anime=回源", "/api/v2/search/episodes", &candidate.to_string())
        .await.unwrap().unwrap()).unwrap();
    assert_eq!(search["animes"][0]["animeTitle"], "回源主档");
    assert_eq!(search["animes"][0]["typeDescription"], "编辑分类");
    assert!(search["animes"][0].get("futureAnimeField").is_none());
    assert_eq!(search["animes"][0]["episodes"].as_array().unwrap().len(), 1);
    assert_eq!(search["animes"][0]["episodes"][0]["episodeTitle"], "字段集名");
    let detail: Value = serde_json::from_str(&service.reconstruct_ingested(
        "GET:/api/v2/bangumi/825", "/api/v2/bangumi/825", &original.to_string())
        .await.unwrap().unwrap()).unwrap();
    // 原候选顺序 10、2 保留；不是本地缓存路径的数字排序 2、10。
    assert_eq!(detail["bangumi"]["episodes"][0]["episodeNumber"], "10");
    assert_eq!(detail["bangumi"]["episodes"][0]["episodeTitle"], "字段集名");
    assert!(service.assemble_bangumi("825").await.unwrap().is_none());
}

#[tokio::test]
async fn contradictory_raw_records_are_ignored() {
    let service = service().await;
    ingest(&service, fixture(821, "真实主档", 2)).await;
    let now = Utc::now().naive_utc();
    for (kind, id) in [("anime", "821"), ("bangumi", "821"), ("episode", "8210010")] {
        raw_entity::ActiveModel {
            entity_type: Set(kind.into()), entity_id: Set(id.into()), anime_id: Set(Some("821".into())),
            title: Set(Some("错误快照".into())), episode_title: Set(Some("错误集标题".into())),
            episode_number: Set(Some("999".into())),
            raw_json: Set(Some(json!({"animeId":999,"animeTitle":"错误快照","episodeId":999,"episodeTitle":"错误集标题","futureAnimeField":true}))),
            api_path: Set("旧路径".into()), cache_key: Set("旧键".into()),
            first_seen_at: Set(now), last_seen_at: Set(now), created_at: Set(now), updated_at: Set(now),
            ..Default::default()
        }.insert(&service.db).await.unwrap();
    }
    let body = assembled_body(service.assemble("GET:/api/v2/search/episodes?anime=真实主档&episode=10").await.unwrap().unwrap());
    assert_eq!(body["animes"][0]["animeId"], 821);
    assert_eq!(body["animes"][0]["animeTitle"], "真实主档");
    assert_eq!(body["animes"][0]["episodes"][0]["episodeTitle"], "十");
    assert!(body["animes"][0].get("futureAnimeField").is_none());
    assert_eq!(assembled_body(service.assemble_bangumi("821").await.unwrap().unwrap())["bangumi"]["animeTitle"], "真实主档");
}

#[tokio::test]
async fn ingestion_rolls_back_all_normalized_writes_on_episode_failure() {
    let service = service().await;
    // 在已写入主档、季和第一集后制造故障，验证整笔摄取事务回滚。
    service.db.execute(Statement::from_string(DbBackend::Sqlite,
        "CREATE TRIGGER reject_episode BEFORE INSERT ON episodes WHEN NEW.upstream_episode_id = '8220002' BEGIN SELECT RAISE(ABORT, '模拟分集写入失败'); END"))
        .await.unwrap();
    let result = service.ingest("GET:/api/v2/bangumi/822", "/api/v2/bangumi/822", &fixture(822, "事务作品", 2).to_string()).await;
    assert!(result.is_err());
    assert!(anime::Entity::find().all(&service.db).await.unwrap().is_empty());
    assert!(season::Entity::find().all(&service.db).await.unwrap().is_empty());
    assert!(episode::Entity::find().all(&service.db).await.unwrap().is_empty());
    assert!(episode_link::Entity::find().all(&service.db).await.unwrap().is_empty());
    assert!(anime_alias::Entity::find().all(&service.db).await.unwrap().is_empty());
    assert!(anime_external_id::Entity::find().all(&service.db).await.unwrap().is_empty());
    assert!(raw_entity::Entity::find().all(&service.db).await.unwrap().is_empty());
}

#[tokio::test]
async fn actual_swagger_details_preserve_seasons_members_titles_and_numeric_rating() {
    let service = service().await;
    // 官方详情没有顶层 episodeCount；完整列表本身构成详情证据。
    let raw = json!({"bangumi":{"animeId":901,"bangumiId":"tmdb-tv-901","animeTitle":"真实形状",
        "rating":8.5,"titles":[{"title":"  Original title  ","language":"未知的新语言描述"}],
        "seasons":[{"id":"s1","name":"第一季","episodeCount":1,"airDate":"2026-01-01","summary":"一"},
                   {"id":"s2","name":"第二季","episodeCount":1,"airDate":null,"summary":null}],
        "episodes":[{"episodeId":90102,"seasonId":"s2","episodeNumber":"1","episodeTitle":"二季第一话","lastWatched":"2026-01-02"},
                    {"episodeId":90101,"seasonId":"s1","episodeNumber":"1","episodeTitle":"一季第一话"}]}});
    service.ingest("GET:/api/v2/bangumi/tmdb-tv-901","/api/v2/bangumi/tmdb-tv-901",&raw.to_string()).await.unwrap();
    let detail = assembled_body(service.assemble_bangumi("tmdb-tv-901").await.unwrap().unwrap());
    assert_eq!(detail["bangumi"]["bangumiId"], "tmdb-tv-901");
    assert_eq!(assembled_body(service.assemble_bangumi("901").await.unwrap().unwrap()), detail);
    assert_eq!(detail["bangumi"]["rating"], 8.5);
    assert_eq!(detail["bangumi"]["seasons"],raw["bangumi"]["seasons"]);
    assert_eq!(detail["bangumi"]["titles"],raw["bangumi"]["titles"]);
    assert_eq!(detail["bangumi"]["episodes"][0]["seasonId"],"s2");
    assert_eq!(detail["bangumi"]["episodes"][0]["lastWatched"],"2026-01-02");
    // 删除一个已声明成员后，即使插入历史额外集也不能伪造完整详情。
    episode::Entity::delete_many().filter(episode::Column::UpstreamEpisodeId.eq("90101")).exec(&service.db).await.unwrap();
    assert!(service.assemble_bangumi("tmdb-tv-901").await.unwrap().is_none());
}

#[tokio::test]
async fn invalid_detail_replacement_rolls_back_members_seasons_titles_and_anime() {
    let service = service().await;
    ingest(&service,fixture(902,"保留主档",2)).await;
    let mut broken = fixture(902,"不应写入",2);
    broken["bangumi"]["titles"][0]["language"] = json!(42);
    assert!(service.ingest("GET:/api/v2/bangumi/902","/api/v2/bangumi/902",&broken.to_string()).await.is_err());
    let detail=assembled_body(service.assemble_bangumi("902").await.unwrap().unwrap());
    assert_eq!(detail["bangumi"]["animeTitle"],"保留主档");
    assert_eq!(detail["bangumi"]["episodes"].as_array().unwrap().len(),2);
    assert_eq!(detail["bangumi"]["titles"][0]["language"],"官方标题，简体中文");
}

#[tokio::test]
async fn exact_search_members_and_has_more_are_read_from_fields() {
    let service = service().await;
    let key = "GET:/api/v2/search/anime?keyword=非标题词";
    let raw = json!({"success":true,"hasMore":true,"animes":[
        {"animeId":912,"animeTitle":"后创建但先返回","rating":8.5},
        {"animeId":911,"animeTitle":"先创建但后返回","rating":7.5}]});
    service.ingest(key,"/api/v2/search/anime",&raw.to_string()).await.unwrap();
    let result = assembled_body(service.assemble(key).await.unwrap().unwrap());
    assert_eq!(result["hasMore"],true);
    assert_eq!(result["animes"][0]["animeId"],912);
    let fresh: Value = serde_json::from_str(&service.reconstruct_ingested(key,"/api/v2/search/anime",&raw.to_string()).await.unwrap().unwrap()).unwrap();
    assert_eq!(fresh["hasMore"],true);
    let mut main = anime::Entity::find().filter(anime::Column::UpstreamAnimeId.eq("912")).one(&service.db).await.unwrap().unwrap().into_active_model();
    main.title=Set(Some("人工主档标题".into()));main.update(&service.db).await.unwrap();
    assert_eq!(assembled_body(service.assemble(key).await.unwrap().unwrap())["animes"][0]["animeTitle"],"人工主档标题");
    catalog_search_member::Entity::delete_many().filter(catalog_search_member::Column::RequestKey.eq(key)).exec(&service.db).await.unwrap();
    assert!(service.assemble(key).await.unwrap().is_none());
}

#[tokio::test]
async fn exact_empty_search_reconstructs_without_raw_response() {
    let service = service().await;
    let key = "GET:/api/v2/search/episodes?anime=不存在";
    let raw = json!({"success":true,"hasMore":false,"animes":[]});
    service.ingest(key,"/api/v2/search/episodes",&raw.to_string()).await.unwrap();
    let body = assembled_body(service.assemble(key).await.unwrap().unwrap());
    assert_eq!(body["animes"],json!([]));
    assert_eq!(body["hasMore"],false);
    let fresh: Value = serde_json::from_str(&service.reconstruct_ingested(key,"/api/v2/search/episodes",&raw.to_string()).await.unwrap().unwrap()).unwrap();
    assert_eq!(fresh,body);
}
