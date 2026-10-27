//! Anime Repository - 番剧数据访问层

use sea_orm::{entity::*, query::*, DatabaseConnection, DbErr};
use crate::entities::{anime, episode, anime_alias};

/// 番剧 Repository
pub struct AnimeRepo {
    db: DatabaseConnection,
}

impl AnimeRepo {
    pub fn new(db: DatabaseConnection) -> Self {
        Self { db }
    }

    /// 根据上游 anime ID 查询
    pub async fn find_by_upstream_id(&self, upstream_id: &str) -> Result<Option<anime::Model>, DbErr> {
        anime::Entity::find()
            .filter(anime::Column::UpstreamAnimeId.eq(upstream_id))
            .one(&self.db)
            .await
    }

    /// 根据标题模糊搜索（支持中文/英文）
    pub async fn search_by_title(&self, query: &str, limit: u64) -> Result<Vec<anime::Model>, DbErr> {
        anime::Entity::find()
            .filter(
                anime::Column::Title
                    .like(format!("%{}%", query))
            )
            .limit(limit)
            .all(&self.db)
            .await
    }

    /// 根据别名查询
    pub async fn find_by_alias(&self, alias: &str) -> Result<Vec<anime::Model>, DbErr> {
        // 先从 anime_alias 表查找匹配的 anime_id
        let alias_records = anime_alias::Entity::find()
            .filter(
                anime_alias::Column::AliasNorm.eq(alias)
                    .or(anime_alias::Column::Alias.eq(alias))
            )
            .all(&self.db)
            .await?;
        
        if alias_records.is_empty() {
            return Ok(vec![]);
        }
        
        // 提取所有 anime_id
        let anime_ids: Vec<i64> = alias_records.iter().map(|r| r.anime_id).collect();
        
        // 查询对应的 anime
        anime::Entity::find()
            .filter(anime::Column::Id.is_in(anime_ids))
            .all(&self.db)
            .await
    }

    /// 插入或更新 anime（用于从 dandanplay 同步）
    pub async fn upsert(&self, model: anime::ActiveModel) -> Result<anime::Model, DbErr> {
        model.save(&self.db).await?.try_into_model()
    }
}

/// 分集 Repository
pub struct EpisodeRepo {
    db: DatabaseConnection,
}

impl EpisodeRepo {
    pub fn new(db: DatabaseConnection) -> Self {
        Self { db }
    }

    /// 根据上游 episode ID 查询
    pub async fn find_by_upstream_id(&self, upstream_id: &str) -> Result<Option<episode::Model>, DbErr> {
        episode::Entity::find()
            .filter(episode::Column::UpstreamEpisodeId.eq(upstream_id))
            .one(&self.db)
            .await
    }

    /// 根据 anime ID 查询所有分集
    pub async fn find_by_anime_id(&self, anime_id: i64) -> Result<Vec<episode::Model>, DbErr> {
        episode::Entity::find()
            .filter(episode::Column::AnimeId.eq(anime_id))
            .order_by_asc(episode::Column::EpisodeNumber)
            .all(&self.db)
            .await
    }

    /// 根据上游 anime ID 查询分集
    pub async fn find_by_upstream_anime_id(&self, upstream_anime_id: &str) -> Result<Vec<episode::Model>, DbErr> {
        // 先找到对应的 anime
        let anime = anime::Entity::find()
            .filter(anime::Column::UpstreamAnimeId.eq(upstream_anime_id))
            .one(&self.db)
            .await?;
        
        if let Some(anime) = anime {
            // 再查询该 anime 的所有 episodes
            episode::Entity::find()
                .filter(episode::Column::AnimeId.eq(anime.id))
                .order_by_asc(episode::Column::EpisodeNumber)
                .all(&self.db)
                .await
        } else {
            Ok(vec![])
        }
    }

    /// 插入或更新 episode
    pub async fn upsert(&self, model: episode::ActiveModel) -> Result<episode::Model, DbErr> {
        model.save(&self.db).await?.try_into_model()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{init_db, DbConfig, test_helper::create_test_schema};
    use sea_orm::Set;

    async fn setup_test_db() -> DatabaseConnection {
        let config = DbConfig::default();
        let db = init_db(&config).await.expect("Failed to init test db");
        create_test_schema(&db).await.expect("Failed to create schema");
        db
    }

    #[tokio::test]
    async fn test_anime_repo_find_by_upstream_id() {
        let db = setup_test_db().await;
        let repo = AnimeRepo::new(db.clone());

        // 插入测试数据
        let now = chrono::Utc::now().naive_utc();
        let model = anime::ActiveModel {
            upstream_anime_id: Set("18562".to_string()),
            title: Set(Some("药屋少女的呢喃".to_string())),
            image_url: Set(Some("https://example.com/image.jpg".to_string())),
            type_code: Set(Some("TV".to_string())),
            type_description: Set(Some("电视动画".to_string())),
            source: Set("dandanplay".to_string()),
            episode_count: Set(0),
            first_seen_at: Set(now),
            last_seen_at: Set(now),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };

        repo.upsert(model).await.expect("Failed to insert anime");

        // 查询
        let found = repo.find_by_upstream_id("18562").await.expect("Failed to find");
        assert!(found.is_some());
        assert_eq!(found.unwrap().title, Some("药屋少女的呢喃".to_string()));
    }

    #[tokio::test]
    async fn test_episode_repo_find_by_anime_id() {
        let db = setup_test_db().await;
        let anime_repo = AnimeRepo::new(db.clone());
        let episode_repo = EpisodeRepo::new(db.clone());

        let now = chrono::Utc::now().naive_utc();

        // 先插入 anime
        let anime_model = anime::ActiveModel {
            upstream_anime_id: Set("test_anime".to_string()),
            title: Set(Some("测试番剧".to_string())),
            source: Set("dandanplay".to_string()),
            episode_count: Set(0),
            first_seen_at: Set(now),
            last_seen_at: Set(now),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };
        let anime = anime_repo.upsert(anime_model).await.expect("Failed to insert anime");

        // 插入 episodes
        for i in 1..=3 {
            let ep_model = episode::ActiveModel {
                anime_id: Set(anime.id),
                upstream_episode_id: Set(format!("test_ep_{}", i)),
                episode_number: Set(Some(i.to_string())),
                title: Set(Some(format!("第{}话", i))),
                source_cache_key: Set(format!("cache_key_{}", i)),
                first_seen_at: Set(now),
                last_seen_at: Set(now),
                created_at: Set(now),
                updated_at: Set(now),
                ..Default::default()
            };
            episode_repo.upsert(ep_model).await.expect("Failed to insert episode");
        }

        // 查询
        let episodes = episode_repo.find_by_anime_id(anime.id).await.expect("Failed to find episodes");
        assert_eq!(episodes.len(), 3);
        assert_eq!(episodes[0].episode_number, Some("1".to_string()));
    }
}
