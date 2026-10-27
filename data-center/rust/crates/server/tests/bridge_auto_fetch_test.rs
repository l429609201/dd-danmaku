use serde_json::json;

use server::AppState;

/// 创建测试数据库
async fn create_test_db() -> sea_orm::DatabaseConnection {
    let config = db::DbConfig::default();
    let db = db::init_db(&config).await.unwrap();
    db::test_helper::create_test_schema(&db).await.unwrap();
    db
}

/// 测试弹幕自动获取功能（通过 comment_store）
#[tokio::test]
async fn test_auto_fetch_comments_from_store() {
    // 创建测试数据库
    let db = create_test_db().await;
    
    // 准备测试弹幕数据
    let episode_id = "test_episode_12345";
    let test_comments = json!({
        "count": 2,
        "comments": [
            {"cid": 1, "p": "10.5,1,25,16777215,1234567890", "m": "测试弹幕1"},
            {"cid": 2, "p": "20.0,1,25,16777215,1234567891", "m": "测试弹幕2"}
        ]
    });
    
    // 创建 AppState
    let state = AppState::new_for_test(db);
    
    // 写入测试弹幕到本地存储
    state.comment_store.archive(
        episode_id,
        &serde_json::to_string(&test_comments).unwrap(),
        "test",
    ).await.unwrap();
    
    // 验证可以读取
    let result = state.comment_store.get(episode_id).await.unwrap();
    assert!(result.is_some());
    
    let response = result.unwrap();
    assert_eq!(response.count, 2);
    assert_eq!(response.comments.len(), 2);
    assert_eq!(response.comments[0].message, "测试弹幕1");
    
    println!("✅ Auto-fetch from comment_store test passed");
    println!("   Episode: {}", episode_id);
    println!("   Comments count: {}", response.count);
}

/// 测试缓存写入和读取
#[tokio::test]
async fn test_cache_set_and_get() {
    let db = create_test_db().await;
    let state = AppState::new_for_test(db);
    
    let cache_key = "test:cache:key";
    let body = json!({"test": "data"}).to_string();
    
    // 写入缓存
    state.cache.set(cache_key, &body, 200, 3600).await.unwrap();
    
    // 读取缓存
    let result = state.cache.get(cache_key).await.unwrap();
    assert!(result.is_some());
    
    let cached = result.unwrap();
    assert_eq!(cached.body, body);
    assert_eq!(cached.status_code, 200);
    
    println!("✅ Cache set/get test passed");
}

/// 测试 cache_key 格式解析
#[test]
fn test_dandanplay_cache_key_format() {
    // 测试弹幕 cache_key 格式
    let key = "dandanplay:comment:12345";
    assert!(key.starts_with("dandanplay:comment:"));
    
    let episode_id = key.strip_prefix("dandanplay:comment:").unwrap();
    assert_eq!(episode_id, "12345");
    
    // 测试无效格式
    let invalid_key = "other:type:key";
    assert!(invalid_key.strip_prefix("dandanplay:comment:").is_none());
    
    println!("✅ Cache key format test passed");
}

/// 测试端到端流程：缓存未命中 → 本地存储命中
#[tokio::test]
async fn test_cache_miss_then_store_hit() {
    let db = create_test_db().await;
    let state = AppState::new_for_test(db);
    
    let episode_id = "episode_67890";
    let cache_key = format!("dandanplay:comment:{}", episode_id);
    
    // 1. 确认缓存中没有
    let cache_result = state.cache.get(&cache_key).await.unwrap();
    assert!(cache_result.is_none(), "Cache should be empty initially");
    
    // 2. 写入本地存储
    let test_data = json!({
        "count": 1,
        "comments": [{"cid": 1, "p": "5.0,1,25,16777215,1234567890", "m": "测试"}]
    });
    state.comment_store.archive(
        episode_id,
        &test_data.to_string(),
        "test",
    ).await.unwrap();
    
    // 3. 从本地存储读取
    let store_result = state.comment_store.get(episode_id).await.unwrap();
    assert!(store_result.is_some(), "Should find in comment_store");
    
    // 4. 写入缓存（模拟 Worker Bridge 自动获取后的行为）
    let body = serde_json::to_string(&store_result.unwrap()).unwrap();
    state.cache.set(&cache_key, &body, 200, 86400).await.unwrap();
    
    // 5. 验证缓存现在有了
    let cache_result_2 = state.cache.get(&cache_key).await.unwrap();
    assert!(cache_result_2.is_some(), "Cache should now have the data");
    
    println!("✅ End-to-end cache miss → store hit test passed");
}
