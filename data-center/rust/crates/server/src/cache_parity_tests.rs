//! 缓存契约回归；仅使用独立内存数据库，不读取生产连接配置。
use super::*;
use sea_orm::{ActiveModelTrait, ConnectionTrait, Database, DatabaseBackend, DatabaseConnection, Statement};

async fn service() -> (CacheService, DatabaseConnection) {
    let db = Database::connect("sqlite::memory:").await.unwrap();
    db::test_helper::create_test_schema(&db).await.unwrap();
    (CacheService::new(db.clone()), db)
}

fn search_record(key: &str) -> Value {
    json!({"cache_key": key, "api_path": "/api/v2/search/anime", "method": "GET",
        "status": 200, "headers": {"content-type": "application/json", "x-origin": "fixture"},
        "query": {"keyword": "测试"}, "request_body": "{\"fileName\":\"测试.mkv\"}",
        "body": "{\"success\":true,\"errorCode\":0,\"animes\":[{\"animeId\":101,\"animeTitle\":\"测试\"}]}",
        "ttl": 3600})
}

// 历史原始行必须直接造库，不借新摄取入口重复保存目录 JSON。
async fn seed_legacy_response(db: &DatabaseConnection, key: &str, path: &str, body: &str) {
    let now = chrono::Utc::now().naive_utc();
    api_response_cache::ActiveModel {
        cache_key: Set(key.into()), api_path: Set(path.into()), source: Set("legacy".into()),
        method: Set("GET".into()), status_code: Set(200), storage_mode: Set("redis".into()),
        response_body: Set(Some(body.into())), body_hash: Set("legacy".into()), body_size: Set(body.len() as i32),
        fetched_at: Set(now), refresh_after: Set(now + chrono::Duration::hours(1)),
        expire_at: Set(now + chrono::Duration::hours(2)), refresh_pending: Set(false),
        hit_count: Set(0), stale_hit_count: Set(0), upstream_429_count: Set(0), is_empty: Set(false),
        created_at: Set(now), updated_at: Set(now), ..Default::default()
    }.insert(db).await.unwrap();
}

#[test]
fn rejects_dirty_and_accepts_structured_empty_responses() {
    let path = "/api/v2/search/anime";
    for body in ["", "not-json", "[]", "null", r#"{"success":false,"animes":[{}]}"#,
        r#"{"errorCode":429,"animes":[{}]}"#, r#"{"errorCode":"0","animes":[]}"#] {
        assert!(!cacheable_body(path, body, false), "应拒绝: {body}");
    }
    // 空搜索成功也存为零成员实体，不需要借完整 JSON 负缓存回放。
    assert!(cacheable_body(path, r#"{"success":true,"animes":[]}"#, false));
    assert!(!cacheable_body("/api/v2/match", r#"{"matches":[]}"#, false));
    assert!(!cacheable_body("/api/v2/bangumi/1", r#"{"bangumi":{}}"#, false));
}

#[test]
fn negative_cache_requires_real_empty_search() {
    let body = r#"{"success":true,"errorCode":0,"animes":[]}"#;
    assert!(cacheable_body("/api/v2/search/anime", body, true));
    assert!(cacheable_body("/api/v2/search/episodes", body, true));
    assert!(!cacheable_body("/api/v2/match", body, true));
    assert!(!cacheable_body("/api/v2/search/anime", r#"{"success":false,"animes":[]}"#, true));
    assert!(!cacheable_body("/api/v2/search/anime", r#"{"animes":[{}]}"#, true));
}

#[tokio::test]
async fn same_key_upsert_preserves_counters_and_metadata() {
    let (cache, db) = service().await;
    // 通用响应缓存仍保留原元数据与计数契约；目录命中不再读取此响应体。
    let key = "GET:/api/v2/test/101";
    let mut record = search_record(key);
    record["api_path"] = json!("/api/v2/test/101");
    assert!(cache.upsert_record(&record).await.unwrap());
    let first = cache.get(key).await.unwrap().unwrap();
    assert_eq!(first.status_code, 200);
    assert_eq!(first.headers["x-origin"], "fixture");
    assert!(!first.stale);
    let before = CacheRepo::new(db.clone()).find_by_key(key).await.unwrap().unwrap();
    record["ttl"] = json!(7200);
    record["body"] = json!(r#"{"success":true,"animes":[{"animeId":101,"animeTitle":"测试更新"}]}"#);
    assert!(cache.upsert_record(&record).await.unwrap());
    let after = CacheRepo::new(db).find_by_key(key).await.unwrap().unwrap();
    assert_eq!(before.id, after.id);
    assert_eq!(before.created_at, after.created_at);
    assert_eq!(after.hit_count, 1);
    assert_eq!(after.query_json, Some(json!({"keyword":"测试"})));
    assert_eq!(after.request_body_json, Some(json!({"fileName":"测试.mkv"})));
    assert_eq!(after.body_size as usize, after.response_body.as_ref().unwrap().len());
    assert!(after.body_hash.starts_with("sha256:"));
    assert!((after.expire_at - after.fetched_at).num_seconds() == 7200);
}

#[tokio::test]
async fn expired_requires_allow_stale_and_marks_refresh() {
    let (cache, db) = service().await;
    let key = "GET:/api/v2/test/101";
    let mut record = search_record(key);
    record["api_path"] = json!("/api/v2/test/101");
    assert!(cache.upsert_record(&record).await.unwrap());
    let past = chrono::Utc::now().naive_utc() - chrono::Duration::hours(1);
    api_response_cache::Entity::update_many()
        .col_expr(api_response_cache::Column::ExpireAt, Expr::value(past))
        .col_expr(api_response_cache::Column::RefreshAfter, Expr::value(past))
        .filter(api_response_cache::Column::CacheKey.eq(key)).exec(&db).await.unwrap();
    assert!(cache.get(key).await.unwrap().is_none());
    let hit = cache.get_with_options(key, CacheGetOptions { allow_stale: true, ..Default::default() })
        .await.unwrap().unwrap();
    assert!(hit.stale && hit.served_stale);
    assert_eq!(hit.cached_at, CacheRepo::new(db.clone()).find_by_key(key).await.unwrap().unwrap()
        .fetched_at.and_utc().timestamp_millis());
    let row = CacheRepo::new(db).find_by_key(key).await.unwrap().unwrap();
    assert!(row.refresh_pending);
    assert_eq!(row.hit_count, 1);
    assert_eq!(row.stale_hit_count, 1);
}

#[tokio::test]
async fn alias_only_never_reads_cached_body_or_touches_hit_count() {
    let (cache, db) = service().await;
    let key = "GET:/api/v2/search/anime?keyword=测试";
    assert!(cache.upsert_record(&search_record(key)).await.unwrap());
    assert!(CacheRepo::new(db.clone()).find_by_key(key).await.unwrap().is_none());
    seed_legacy_response(&db, key, "/api/v2/search/anime", "legacy-body").await;
    let options = CacheGetOptions { alias_only: true, ..Default::default() };
    assert!(cache.get_with_options(key, options).await.unwrap().is_none());
    let payload = cache.get_payload(key, options).await.unwrap();
    assert_eq!(payload["hit"], false);
    assert!(payload.get("body").is_none());
    assert_eq!(CacheRepo::new(db).find_by_key(key).await.unwrap().unwrap().hit_count, 0);
}

#[tokio::test]
async fn old_sql_dirty_nonstructured_records_are_misses_without_touch_or_fallback() {
    let (cache, db) = service().await;
    let key = "GET:/api/v2/test/101";
    let mut record = search_record(key);
    record["api_path"] = json!("/api/v2/test/101");
    assert!(cache.upsert_record(&record).await.unwrap());
    // 通用非结构化接口仍校验旧响应，不得返回脏响应。
    for (status, body, is_empty) in [
        (200, "not-json", false),
        (200, r#"{"success":false,"animes":[{}]}"#, false),
        (200, r#"{"errorCode":429,"animes":[{}]}"#, false),
        (200, r#"{"success":true,"animes":[{}]}"#, true),
        (429, r#"{"success":true,"animes":[{}]}"#, false),
    ] {
        api_response_cache::Entity::update_many()
            .col_expr(api_response_cache::Column::StatusCode, Expr::value(status))
            .col_expr(api_response_cache::Column::ResponseBody, Expr::value(body))
            .col_expr(api_response_cache::Column::IsEmpty, Expr::value(is_empty))
            .filter(api_response_cache::Column::CacheKey.eq(key)).exec(&db).await.unwrap();
        assert!(cache.get_with_options(key, CacheGetOptions { allow_stale: true, ..Default::default() })
            .await.unwrap().is_none(), "不应返回旧脏记录: {body}");
        let row = CacheRepo::new(db.clone()).find_by_key(key).await.unwrap().unwrap();
        assert_eq!(row.hit_count, 0);
        assert!(row.last_used_at.is_none());
        assert!(!row.refresh_pending);
    }
}

#[test]
fn structured_catalog_keys_preserve_method_and_parameter_boundaries() {
    for key in ["GET:/api/v2/search/anime?keyword=测试", "GET:/api/v2/search/anime?anime=测试",
        "GET:/api/v2/search/episodes?anime=测试&episode=1", "GET:/api/v2/bangumi/101",
        "POST:/api/v2/search/anime?keyword=测试", "GET:/api/v2/search/anime?keyword=测试&type=tv",
        "GET:/api/v2/search/anime?keyword=", "GET:/api/v2/bangumi/101?unsupported=1",
        "GET:/api/v2/bangumi/101#fragment"] {
        assert!(catalog_key(key), "必须保留字段边界: {key}");
    }
    for key in ["EMPTY:/api/v2/search/anime?anime=测试", "GET:/api/v2/test/101"] {
        assert!(!catalog_key(key), "不属于目录边界: {key}");
    }
}

#[tokio::test]
async fn normalized_catalog_fields_win_over_contradictory_old_response() {
    let (cache, db) = service().await;
    let key = "GET:/api/v2/search/anime?keyword=测试";
    assert!(cache.upsert_record(&search_record(key)).await.unwrap());
    db::entities::anime::Entity::update_many()
        .col_expr(db::entities::anime::Column::ImageUrl, Expr::value("normalized-image"))
        .exec(&db).await.unwrap();
    // 模拟冲突历史冷备，规范化字段仍必须先返回。
    seed_legacy_response(&db, key, "/api/v2/search/anime",
        r#"{"success":true,"animes":[{"animeId":999,"animeTitle":"旧JSON","imageUrl":"old-image"}]}"#).await;
    let hit = cache.get(key).await.unwrap().unwrap();
    assert!(hit.assembled);
    let body: Value = serde_json::from_str(&hit.body).unwrap();
    assert_eq!(body["animes"][0]["animeId"], 101);
    assert_eq!(body["animes"][0]["imageUrl"], "normalized-image");
    assert_eq!(body["animes"][0]["animeTitle"], "测试");
}

#[tokio::test]
async fn incomplete_catalog_entities_never_fall_back_to_old_response() {
    let (cache, db) = service().await;
    let key = "GET:/api/v2/search/episodes?anime=测试";
    let mut record = search_record(key);
    record["api_path"] = json!("/api/v2/search/episodes");
    record["body"] = json!(r#"{"success":true,"animes":[{"animeId":101,"animeTitle":"测试","episodeCount":2,"episodes":[{"episodeId":1010001,"episodeTitle":"第一集"}]}]}"#);
    assert!(cache.upsert_record(&record).await.unwrap());
    assert!(CacheRepo::new(db.clone()).find_by_key(key).await.unwrap().is_none());
    seed_legacy_response(&db, key, "/api/v2/search/episodes", record["body"].as_str().unwrap()).await;
    for allow_stale in [false, true] {
        assert!(cache.get_with_options(key, CacheGetOptions { allow_stale, ..Default::default() })
            .await.unwrap().is_none());
    }
    // 即使响应 JSON 完好，实体被移除也只能回源。
    db::entities::anime::Entity::delete_many().exec(&db).await.unwrap();
    assert!(cache.get(key).await.unwrap().is_none());
    assert_eq!(CacheRepo::new(db).find_by_key(key).await.unwrap().unwrap().hit_count, 0);
}

#[tokio::test]
async fn bangumi_without_entities_never_uses_old_response() {
    let (cache, db) = service().await;
    // 直接构造历史响应行，独立验证详情键也必须走字段拼装。
    let key = "GET:/api/v2/bangumi/101";
    let mut record = search_record("GET:/api/v2/test/101");
    record["api_path"] = json!("/api/v2/test/101");
    assert!(cache.upsert_record(&record).await.unwrap());
    api_response_cache::Entity::update_many()
        .col_expr(api_response_cache::Column::CacheKey, Expr::value(key))
        .col_expr(api_response_cache::Column::ApiPath, Expr::value("/api/v2/bangumi/101"))
        .col_expr(api_response_cache::Column::ResponseBody,
            Expr::value(r#"{"success":true,"bangumi":{"animeId":101,"animeTitle":"旧详情"}}"#))
        .exec(&db).await.unwrap();
    assert!(cache.get_with_options(key, CacheGetOptions { allow_stale: true, ..Default::default() })
        .await.unwrap().is_none());
}

#[tokio::test]
async fn catalog_ingest_failure_does_not_report_success_or_write_response() {
    let (cache, db) = service().await;
    // 模拟字段表不可写，确保失败发生在响应缓存持久化之前。
    db.execute(Statement::from_string(DatabaseBackend::Sqlite, "DROP TABLE animes".to_owned())).await.unwrap();
    let key = "GET:/api/v2/search/anime?keyword=测试";
    assert!(cache.upsert_record(&search_record(key)).await.is_err());
    assert!(CacheRepo::new(db).find_by_key(key).await.unwrap().is_none());
}

#[tokio::test]
async fn catalog_ingest_transaction_failure_preserves_previous_fields_and_cache() {
    let (cache, db) = service().await;
    let key = "GET:/api/v2/search/anime?keyword=测试";
    let mut record = search_record(key);
    assert!(cache.upsert_record(&record).await.unwrap());
    seed_legacy_response(&db, key, "/api/v2/search/anime", "历史正文").await;
    let before = CacheRepo::new(db.clone()).find_by_key(key).await.unwrap().unwrap();
    // 在主档已更新、分集尚未完成时注入失败，验证实体事务回滚且旧缓存不被替换。
    db.execute(Statement::from_string(DatabaseBackend::Sqlite,
        "CREATE TRIGGER reject_episode_insert BEFORE INSERT ON episodes BEGIN SELECT RAISE(ABORT, 'fixture episode failure'); END".to_owned()))
        .await.unwrap();
    record["body"] = json!(r#"{"success":true,"animes":[{"animeId":101,"animeTitle":"未提交标题","episodes":[{"episodeId":1010001,"episodeTitle":"未提交集"}]}]}"#);
    assert!(cache.upsert_record(&record).await.is_err());
    let main = db::entities::anime::Entity::find().one(&db).await.unwrap().unwrap();
    assert_eq!(main.title.as_deref(), Some("测试"));
    let after = CacheRepo::new(db).find_by_key(key).await.unwrap().unwrap();
    assert_eq!(after.response_body, before.response_body);
    assert_eq!(after.fetched_at, before.fetched_at);
}

#[tokio::test]
async fn bangumi_fields_win_and_missing_episodes_do_not_return_old_json() {
    let (cache, db) = service().await;
    let key = "GET:/api/v2/bangumi/101";
    let mut record = search_record(key);
    record["api_path"] = json!("/api/v2/bangumi/101");
    record["body"] = json!(json!({"success":true,"bangumi":{"animeId":101,
        "animeTitle":"测试详情","episodeCount":1,"episodes":[{"episodeId":1010001,
        "episodeNumber":"1","episodeTitle":"原集标题"}]}}).to_string());
    assert!(cache.upsert_record(&record).await.unwrap());
    // 详情与搜索一样必须读取字段，不能被完整但矛盾的旧响应覆盖。
    db::entities::episode::Entity::update_many()
        .col_expr(db::entities::episode::Column::Title, Expr::value("字段集标题"))
        .exec(&db).await.unwrap();
    seed_legacy_response(&db, key, "/api/v2/bangumi/101",
        r#"{"success":true,"bangumi":{"animeId":999,"animeTitle":"旧详情"}}"#).await;
    let hit = cache.get(key).await.unwrap().unwrap();
    assert!(hit.assembled);
    let body: Value = serde_json::from_str(&hit.body).unwrap();
    assert_eq!(body["bangumi"]["animeId"], 101);
    assert_eq!(body["bangumi"]["episodes"][0]["episodeTitle"], "字段集标题");
    db::entities::episode::Entity::delete_many().exec(&db).await.unwrap();
    assert!(cache.get_with_options(key, CacheGetOptions { allow_stale: true, ..Default::default() })
        .await.unwrap().is_none());
}

#[tokio::test]
async fn eligible_catalog_assembly_does_not_query_response_table() {
    let (cache, db) = service().await;
    let key = "GET:/api/v2/search/anime?keyword=测试";
    assert!(cache.upsert_record(&search_record(key)).await.unwrap());
    // 删除响应缓存表后，已有字段仍可响应；字段不存在时也直接 miss 而不是查询旧缓存。
    db.execute(Statement::from_string(DatabaseBackend::Sqlite, "DROP TABLE api_response_cache".to_owned()))
        .await.unwrap();
    assert!(cache.get(key).await.unwrap().unwrap().assembled);
    for missing in ["GET:/api/v2/search/anime?keyword=完全不存在", "GET:/api/v2/bangumi/missing"] {
        assert!(cache.get(missing).await.unwrap().is_none());
    }
}

#[tokio::test]
async fn unknown_query_parameters_never_fall_back_to_raw_response() {
    let (cache, db) = service().await;
    for key in ["GET:/api/v2/search/anime?keyword=测试&unsupported=1",
        "GET:/api/v2/search/anime?keyword=测试&keyword=别的",
        "GET:/api/v2/search/episodes?anime=测试&unsupported=1"] {
        let mut record = search_record(key);
        record["api_path"] = json!(key.strip_prefix("GET:").unwrap().split('?').next().unwrap());
        assert!(cache.upsert_record(&record).await.unwrap());
        seed_legacy_response(&db, key, record["api_path"].as_str().unwrap(), record["body"].as_str().unwrap()).await;
        assert!(cache.get(key).await.unwrap().is_none());
    }
}

#[tokio::test]
async fn protocol_rpc_keys_use_fields_and_never_read_old_json() {
    let (cache, db) = service().await;
    for (key, path, body) in [
        ("POST:/api/v2/match?request_hash=one", "/api/v2/match",
            json!({"success":true,"isMatched":true,"matches":[{"animeId":101,"episodeId":1010001,"episodeTitle":"字段标题"}]})),
        ("GET:/api/v2/comment/1010001?withRelated=true", "/api/v2/comment/1010001",
            json!({"success":true,"count":1,"comments":[{"cid":1,"p":"1,1,25,16777215","m":"字段弹幕"}]})),
    ] {
        let record = json!({"cache_key":key,"api_path":path,"body":body.to_string(),"status":200});
        assert!(cache.upsert_record(&record).await.unwrap());
        assert!(CacheRepo::new(db.clone()).find_by_key(key).await.unwrap().is_none());
        let hit = cache.get_payload(key, CacheGetOptions::default()).await.unwrap();
        assert_eq!(hit["assembled"], true);
        let assembled: Value = serde_json::from_str(hit["body"].as_str().unwrap()).unwrap();
        assert_eq!(assembled, body);
        // 原始缓存键区分完整查询/请求摘要，不能串用另一个请求的结构化结果。
        assert!(cache.get(&format!("{key}&other=1")).await.unwrap().is_none());
    }
    // 即使旧 JSON 存在，缺少协议字段时也不得兜底。
    let old_key = "GET:/api/v2/test/101";
    let mut old = search_record(old_key);
    old["api_path"] = json!("/api/v2/test/101");
    assert!(cache.upsert_record(&old).await.unwrap());
    api_response_cache::Entity::update_many()
        .col_expr(api_response_cache::Column::CacheKey, Expr::value("GET:/api/v2/comment/missing"))
        .col_expr(api_response_cache::Column::ApiPath, Expr::value("/api/v2/comment/missing"))
        .exec(&db).await.unwrap();
    assert!(cache.get("GET:/api/v2/comment/missing").await.unwrap().is_none());
}

#[tokio::test]
async fn invalid_protocol_fields_fail_before_cache_success() {
    let (cache, db) = service().await;
    let key = "POST:/api/v2/match?request_hash=invalid";
    let record = json!({"cache_key":key,"api_path":"/api/v2/match","status":200,
        "body":json!({"success":true,"isMatched":true,"matches":[{"animeId":"wrong","episodeId":1}]}).to_string()});
    assert!(cache.upsert_record(&record).await.is_err());
    assert!(CacheRepo::new(db).find_by_key(key).await.unwrap().is_none());
    assert!(cache.get(key).await.unwrap().is_none());
}

#[tokio::test]
async fn empty_probe_and_explicit_negative_flags_are_not_assembled() {
    let (cache, _) = service().await;
    assert!(cache.upsert_record(&search_record("GET:/api/v2/search/anime?keyword=测试")).await.unwrap());
    let key = "EMPTY:/api/v2/search/anime?anime=测试";
    assert!(cache.get(key).await.unwrap().is_none());
    let mut record = search_record(key);
    record["body"] = json!(r#"{"success":true,"errorCode":0,"animes":[]}"#);
    assert!(!cache.upsert_record(&record).await.unwrap());
    record["is_empty"] = json!(true);
    record["status"] = json!(429);
    assert!(!cache.upsert_record(&record).await.unwrap());
    record["status"] = json!(200);
    assert!(cache.upsert_record(&record).await.unwrap());
    let hit = cache.get(key).await.unwrap().unwrap();
    assert!(hit.is_empty);
    assert!(!hit.assembled);
    assert_eq!(hit.payload()["is_empty"], true);
}
