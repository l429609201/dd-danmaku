//! 本地实体摄取与响应拼装；内部主键只用于关联，响应始终使用上游标识。
use std::collections::{BTreeMap, HashSet};

use anyhow::Result;
use chrono::Utc;
use db::entities::{anime, anime_alias, anime_external_id,
    episode, episode_link, season, bangumi_version, bangumi_season, bangumi_episode_member, bangumi_title, catalog_search_result, catalog_search_member};
use regex::Regex;
use sea_orm::{ActiveModelTrait, ColumnTrait, Condition, ConnectionTrait, DatabaseConnection,
    EntityTrait, IntoActiveModel, QueryFilter, QueryOrder, QuerySelect, Set, TransactionTrait};
use serde_json::{json, Map, Value};
use unicode_normalization::UnicodeNormalization;

#[derive(Clone)]
pub struct EntityService {
    db: DatabaseConnection,
}

impl EntityService {
    pub fn new(db: DatabaseConnection) -> Self { Self { db } }

    /// 同一响应内的主档、季、集、别名、外部标识与自动链接原子提交；不创建或修改 schema。
    pub async fn ingest(&self, cache_key: &str, api_path: &str, body: &str) -> Result<()> {
        let data: Value = serde_json::from_str(body)?;
        if data.get("success").and_then(Value::as_bool) == Some(false) { return Ok(()); }
        let detail = api_path.contains("/bangumi/");
        let search = api_path.contains("/search/anime") || api_path.contains("/search/episodes");
        if !detail && !search { return Ok(()); }
        let parents: Vec<&Value> = if detail {
            vec![data.get("bangumi").unwrap_or(&data)]
        } else {
            data.get("animes").and_then(Value::as_array).map(|a| a.iter().collect()).unwrap_or_default()
        };
        let txn = self.db.begin().await?;
        let mut ids = Vec::new();
        for raw in parents {
            if !raw.is_object() { continue; }
            let Some(aid) = text(raw, "animeId").or_else(|| text(raw, "bangumiId")) else { continue; };
            let title = text(raw, "animeTitle").or_else(|| text(raw, "title"));
            let main = upsert_anime(&txn, &aid, raw, detail).await?;
            crate::catalog_fields::ingest(&txn, &main.upstream_anime_id, raw, detail).await?;
            ids.push(main.id);
            // 没有独立 bangumiId 的详情仍可用明确的 animeId 作为上游详情标识，绝不使用内部主键。
            let bid = text(raw, "bangumiId").or_else(|| detail.then(|| aid.clone()));
            let sid = if detail || bid.is_some() {
                Some(upsert_season(&txn, &main, bid.clone(), title.clone(), raw).await?.id)
            } else { None };
            for ep in raw.get("episodes").and_then(Value::as_array).into_iter().flatten() {
                let Some(eid) = text(ep, "episodeId") else { continue; };
                let number = episode_number(ep, &eid, &aid);
                let ep_title = text(ep, "episodeTitle");
                upsert_episode(&txn, main.id, sid, &eid, number.clone(), ep, cache_key).await?;
                if detail {
                    upsert_link(&txn, &aid, bid.as_deref(), &eid, title.as_deref(),
                        number, ep_title, cache_key).await?;
                }
            }
            if detail { ingest_bangumi_fields(&txn, main.id, bid.as_deref().unwrap_or(&aid), raw).await?; }
            ingest_titles(&txn, main.id, raw).await?;
            ingest_external_ids(&txn, main.id, raw).await?;
        }
        if search {
            let parents = data.get("animes").and_then(Value::as_array).ok_or_else(|| anyhow::anyhow!("搜索响应缺少 animes"))?;
            anyhow::ensure!(ids.len() == parents.len(), "搜索候选缺少有效 animeId");
            catalog_search_member::Entity::delete_many().filter(catalog_search_member::Column::RequestKey.eq(cache_key)).exec(&txn).await?;
            catalog_search_result::Entity::delete_by_id(cache_key).exec(&txn).await?;
            let has_more = match data.get("hasMore") {None => false, Some(Value::Bool(v)) => *v, _ => anyhow::bail!("hasMore 必须为布尔值")};
            catalog_search_result::ActiveModel {request_key:Set(cache_key.into()),has_more:Set(has_more),candidate_count:Set(i64::try_from(ids.len())?)}.insert(&txn).await?;
            for (ordinal, id) in ids.iter().enumerate() {
                catalog_search_member::ActiveModel {request_key:Set(cache_key.into()),ordinal:Set(i64::try_from(ordinal)?),anime_id:Set(*id)}.insert(&txn).await?;
            }
        }
        ids.sort_unstable(); ids.dedup();
        if search && !ids.is_empty() && ids.len() <= 5 {
            if let Some(term) = parse_key(cache_key).map(|q| q.title) {
                let single = ids.len() == 1;
                for id in ids {
                    upsert_alias(&txn, id, &term, None, "search_keyword",
                        if single { "cache_extract_1" } else { "cache_extract_n" },
                        if single { "approved" } else { "pending" }, if single { 85 } else { 60 }).await?;
                }
            }
        }
        txn.commit().await?;
        Ok(())
    }

    /// 返回 Python 同形的 {mode,body}，body 为序列化的弹弹响应；不可靠的整季返回 None。
    pub async fn assemble(&self, cache_key: &str) -> Result<Option<Value>> {
        // 详情只接受无查询参数的已知路径，未知参数必须由上游解释。
        if let Some(id) = cache_key.strip_prefix("GET:/api/v2/bangumi/") {
            if !id.is_empty() && !id.contains(['?', '/', '#']) {
                return self.assemble_bangumi(id).await;
            }
            return Ok(None);
        }
        let Some(query) = parse_key(cache_key) else { return Ok(None); };
        let exact = catalog_search_result::Entity::find_by_id(cache_key).one(&self.db).await?;
        let mut rows = Vec::new();
        if let Some(result) = &exact {
            let members = catalog_search_member::Entity::find().filter(catalog_search_member::Column::RequestKey.eq(cache_key))
                .order_by_asc(catalog_search_member::Column::Ordinal).all(&self.db).await?;
            if members.len() as i64 != result.candidate_count { return Ok(None); }
            for member in members {
                let Some(main) = anime::Entity::find_by_id(member.anime_id).one(&self.db).await? else { return Ok(None); };
                rows.push(main);
            }
        } else {
            rows = anime::Entity::find().filter(anime::Column::Title.eq(&query.title))
                .order_by_asc(anime::Column::Id).all(&self.db).await?;
            if rows.is_empty() && query.title.chars().count() >= 4 {
                rows = anime::Entity::find().filter(anime::Column::Title.starts_with(&query.title))
                    .order_by_asc(anime::Column::Id).limit(5).all(&self.db).await?;
                if rows.len() == 1 && single_high_season(&query.title, rows[0].title.as_deref().unwrap_or("")) {
                    return Ok(None);
                }
            }
        }
        if rows.is_empty() && exact.is_none() { return Ok(None); }
        let mut animes = Vec::new();
        for row in rows {
            let mut obj = self.anime_object(&row).await?;
            if query.episodes {
                let eps = self.episodes_for(&row, None, query.episode.as_deref()).await?;
                // 任一候选缺集时整体回源，避免同系列结果被悄悄缩短。
                if query.episode.is_none() && (row.episode_count <= 0 || eps.len() < row.episode_count as usize) {
                    return Ok(None);
                }
                if eps.is_empty() { continue; }
                obj.insert("episodes".into(), Value::Array(eps));
            } else { obj.remove("episodes"); }
            animes.push(Value::Object(obj));
        }
        if animes.is_empty() && !exact.as_ref().is_some_and(|r| r.candidate_count == 0) { return Ok(None); }
        let body = json!({"hasMore":exact.as_ref().is_some_and(|r| r.has_more),"animes":animes,"errorCode":0,"success":true});
        Ok(Some(json!({"body":serde_json::to_string(&body)?,"mode":if !query.episodes {"anime"}
            else if query.episode.is_some() {"episodes_single"} else {"episodes_season"}})))
    }

    /// 429 别名兜底允许部分集；只从集表读取，并应用明确的人工修正。
    pub async fn alias_query(&self, keyword: &str) -> Result<Value> {
        let libraries = self.resolve_libraries(keyword).await?;
        let mut data = Vec::new();
        for row in libraries {
            let episodes = self.episodes_for(&row, None, None).await?;
            if episodes.is_empty() { continue; }
            data.push(json!({"animeId":upstream_value(&row.upstream_anime_id),
                "animeTitle":row.title.as_deref().unwrap_or(&row.upstream_anime_id),
                "type":row.type_code.as_deref().unwrap_or("tvseries"),
                "typeDescription":row.type_description.as_deref().unwrap_or("TV动画"),
                "episodes":episodes}));
        }
        Ok(json!({"success":!data.is_empty(),"data":data}))
    }

    /// 已缓存响应的系列修正：仅无集号的搜索，补全多季或拦截唯一高季误命中。
    pub async fn series_override(&self, cache_key: &str, cached_body: &str) -> Result<Option<Value>> {
        let Some(query) = parse_key(cache_key) else { return Ok(None); };
        if !query.episodes || cache_key.contains("episode=") { return Ok(None); }
        let local = self.alias_query(&query.title).await?;
        let local = local.get("data").and_then(Value::as_array).cloned().unwrap_or_default();
        let cached: Value = serde_json::from_str(cached_body).unwrap_or(Value::Null);
        let cached = cached.get("animes").and_then(Value::as_array).cloned().unwrap_or_default();
        let body = if local.len() >= 2 && local.len() > cached.len() {
            json!({"hasMore":false,"animes":local,"errorCode":0,"success":true})
        } else if cached.len() == 1 && single_high_season(&query.title,
            cached[0].get("animeTitle").and_then(Value::as_str).unwrap_or("")) {
            json!({"hasMore":false,"animes":[],"errorCode":0,"success":true,"errorMessage":""})
        } else { return Ok(None); };
        Ok(Some(json!({"mode":"series","body":serde_json::to_string(&body)?})))
    }

    /// approved 搜索词改写，不查询响应缓存、不组装分集；主标题相同时尝试另一官方标题。
    pub async fn resolve_search_term(&self, cache_key: &str) -> Result<Option<Value>> {
        let Some(query) = parse_key(cache_key) else { return Ok(None); };
        // 裸系列已能解析到多季时不能改写为其中一季，alias_only 也只读主档元数据。
        if self.resolve_libraries(&query.title).await?.len() > 1 { return Ok(None); }
        let norm = normalize(&query.title);
        let mut aliases = anime_alias::Entity::find().filter(anime_alias::Column::Status.eq("approved"))
            .filter(anime_alias::Column::AliasNorm.eq(&norm))
            .order_by_desc(anime_alias::Column::Confidence).order_by_desc(anime_alias::Column::Id)
            .limit(5).all(&self.db).await?;
        if aliases.is_empty() {
            aliases = anime_alias::Entity::find().filter(anime_alias::Column::Status.eq("approved"))
                .filter(anime_alias::Column::AliasNormNs.eq(no_spaces(&norm)))
                .order_by_desc(anime_alias::Column::Confidence).order_by_desc(anime_alias::Column::Id)
                .limit(5).all(&self.db).await?;
        }
        for alias in aliases {
            let Some(main) = anime::Entity::find_by_id(alias.anime_id).one(&self.db).await? else { continue; };
            let mut canonical = main.title.clone().unwrap_or_default();
            let mut source = alias.source.clone();
            let mut confidence = alias.confidence;
            if canonical.is_empty() || normalize(&canonical) == norm {
                let official = anime_alias::Entity::find().filter(anime_alias::Column::AnimeId.eq(main.id))
                    .filter(anime_alias::Column::Status.eq("approved"))
                    .filter(anime_alias::Column::Source.eq("dandanplay_titles"))
                    .order_by_desc(anime_alias::Column::Confidence).order_by_desc(anime_alias::Column::Id)
                    .all(&self.db).await?;
                let Some(other) = official.into_iter().find(|a| normalize(&a.alias) != norm) else { continue; };
                canonical = other.alias; source = other.source; confidence = other.confidence;
            }
            // 裸系列词不能仅靠某个高季度别名被静默改写成该季。
            if single_high_season(&query.title, &canonical) { continue; }
            return Ok(Some(json!({"alias_hit":true,"term":query.title,"canonical":canonical,
                "anime_id":main.upstream_anime_id,"source":source,"confidence":confidence})));
        }
        Ok(None)
    }

    /// 详情由结构化实体拼装；缺少整季完整性证据时回源，不借用原始响应。
    pub async fn assemble_bangumi(&self, id: &str) -> Result<Option<Value>> {
        let snapshot = if let Some(snapshot) = bangumi_version::Entity::find_by_id(id).one(&self.db).await? {
            snapshot
        } else {
            // 官方同时接受数字 animeId 与字符串 bangumiId，两者不能误判为不同作品。
            let Some(main) = anime::Entity::find().filter(anime::Column::UpstreamAnimeId.eq(id)).one(&self.db).await? else { return Ok(None); };
            let mut versions = bangumi_version::Entity::find().filter(bangumi_version::Column::AnimeId.eq(main.id)).all(&self.db).await?;
            if versions.len() != 1 { return Ok(None); }
            versions.remove(0)
        };
        let Some(main) = anime::Entity::find_by_id(snapshot.anime_id).one(&self.db).await? else { return Ok(None); };
        let Some(version) = season::Entity::find().filter(season::Column::AnimeId.eq(main.id))
            .filter(season::Column::UpstreamBangumiId.eq(&snapshot.upstream_bangumi_id)).one(&self.db).await? else { return Ok(None); };
        let Some(episodes) = self.bangumi_episodes(&main, &snapshot, true).await? else { return Ok(None); };
        let obj = self.bangumi_object(&main, &version, episodes).await?;
        let body = json!({"bangumi":obj,"errorCode":0,"success":true});
        Ok(Some(json!({"mode":"bangumi","body":serde_json::to_string(&body)?})))
    }

    /// 上游本次响应仅提供候选身份和顺序；返回内容全部从已入库字段重建。
    pub async fn reconstruct_ingested(&self, cache_key: &str, api_path: &str, body: &str) -> Result<Option<String>> {
        let data: Value = serde_json::from_str(body)?;
        if data.get("success").and_then(Value::as_bool) == Some(false) { return Ok(None); }
        let detail = api_path.contains("/bangumi/");
        let search = api_path.contains("/search/anime") || api_path.contains("/search/episodes");
        if !detail && !search { return Ok(None); }
        let parents: Vec<&Value> = if detail {
            vec![data.get("bangumi").unwrap_or(&data)]
        } else {
            let Some(items) = data.get("animes").and_then(Value::as_array) else { return Ok(None); };
            items.iter().collect()
        };
        let mut results = Vec::new();
        for candidate in parents {
            let Some(aid) = text(candidate, "animeId").or_else(|| text(candidate, "bangumiId")) else { return Ok(None); };
            let Some(main) = anime::Entity::find().filter(anime::Column::UpstreamAnimeId.eq(&aid))
                .one(&self.db).await? else { return Ok(None); };
            let version = if detail {
                let bid = text(candidate, "bangumiId").unwrap_or_else(|| aid.clone());
                let Some(version) = season::Entity::find().filter(season::Column::AnimeId.eq(main.id))
                    .filter(season::Column::UpstreamBangumiId.eq(bid)).one(&self.db).await? else { return Ok(None); };
                Some(version)
            } else { None };
            let mut obj = self.anime_object(&main).await?;
            if detail || api_path.contains("/search/episodes") {
                let fields = if let Some(version) = version.as_ref() {
                    let Some(snapshot) = bangumi_version::Entity::find_by_id(version.upstream_bangumi_id.clone().unwrap_or_default()).one(&self.db).await? else { return Ok(None); };
                    let Some(fields) = self.bangumi_episodes(&main, &snapshot, false).await? else { return Ok(None); };
                    fields
                } else { self.episodes_for(&main, None, None).await? };
                let mut episodes = Vec::new();
                // 允许返回本次上游给出的部分集，但不把其他历史集混入此次响应。
                for identity in candidate.get("episodes").and_then(Value::as_array).into_iter().flatten() {
                    let Some(eid) = text(identity, "episodeId") else { return Ok(None); };
                    let Some(ep) = fields.iter().find(|ep| text(ep, "episodeId").as_deref() == Some(eid.as_str())) else { return Ok(None); };
                    episodes.push(ep.clone());
                }
                if let Some(version) = version.as_ref() {
                    obj = self.bangumi_object(&main, version, episodes).await?;
                } else {
                    obj.insert("episodes".into(), json!(episodes));
                }
            }
            results.push(Value::Object(obj));
        }
        let rebuilt = if detail {
            if results.len() != 1 { return Ok(None); }
            json!({"bangumi":results.remove(0),"errorCode":0,"success":true})
        } else {
            let has_more = catalog_search_result::Entity::find_by_id(cache_key).one(&self.db).await?.is_some_and(|r| r.has_more);
            json!({"animes":results,"hasMore":has_more,"errorCode":0,"success":true})
        };
        Ok(Some(serde_json::to_string(&rebuilt)?))
    }

    async fn bangumi_object(&self, main: &anime::Model, version: &season::Model, episodes: Vec<Value>) -> Result<Map<String, Value>> {
        let mut obj = self.anime_object(main).await?;
        if let Some(id) = &version.upstream_bangumi_id { obj.insert("bangumiId".into(), json!(id)); }
        // 标题以可编辑主档为唯一事实来源，版本标签不遮蔽主档修正。
        if main.title.is_none() { if let Some(title) = &version.title { obj.insert("animeTitle".into(), json!(title)); } }
        if main.summary.is_none() { if let Some(summary) = &version.summary { obj.insert("summary".into(), json!(summary)); } }
        if let Some(number) = version.season_number { obj.insert("seasonNumber".into(), json!(number)); }
        obj.insert("episodes".into(), json!(episodes));
        let bid = version.upstream_bangumi_id.as_deref().unwrap_or_default();
        let titles = bangumi_title::Entity::find().filter(bangumi_title::Column::UpstreamBangumiId.eq(bid))
            .order_by_asc(bangumi_title::Column::Ordinal).all(&self.db).await?;
        obj.insert("titles".into(), json!(titles.iter().map(|t| json!({"title":t.title,"language":t.language})).collect::<Vec<_>>()));
        let seasons = bangumi_season::Entity::find().filter(bangumi_season::Column::UpstreamBangumiId.eq(bid))
            .order_by_asc(bangumi_season::Column::Ordinal).all(&self.db).await?;
        obj.insert("seasons".into(), json!(seasons.iter().map(|s| json!({"id":s.upstream_season_id,
            "name":s.name,"airDate":s.air_date,"episodeCount":s.episode_count,"summary":s.summary})).collect::<Vec<_>>()));
        let external = anime_external_id::Entity::find().filter(anime_external_id::Column::AnimeId.eq(main.id))
            .order_by_asc(anime_external_id::Column::Id).all(&self.db).await?;
        let databases: Vec<_> = external.iter().filter_map(|entry| {
            let url = entry.external_url.as_ref()?;
            if entry.provider == "bangumi_tv" { obj.insert("bangumiUrl".into(), json!(url)); }
            Some(json!({"name":external_name(&entry.provider),"url":url}))
        }).collect();
        obj.insert("onlineDatabases".into(), json!(databases));
        obj.extend(crate::catalog_fields::assemble(&self.db, &main.upstream_anime_id, true).await?);
        Ok(obj)
    }

    async fn anime_object(&self, main: &anime::Model) -> Result<Map<String, Value>> {
        // 主档字段是响应的唯一来源，业务修正无需同步任何响应快照。
        let mut obj = crate::catalog_fields::assemble(&self.db, &main.upstream_anime_id, false).await?;
        obj.insert("animeId".into(), upstream_value(&main.upstream_anime_id));
        obj.insert("animeTitle".into(), json!(main.title));
        obj.insert("episodeCount".into(), json!(main.episode_count));
        for (key, value) in [("imageUrl", &main.image_url), ("type", &main.type_code),
            ("typeDescription", &main.type_description), ("summary", &main.summary),
            ("startDate", &main.start_date)] {
            if let Some(value) = value { obj.insert(key.into(), json!(value)); }
        }
        if let Some(rating) = main.rating.as_deref().and_then(|s| s.parse::<serde_json::Number>().ok()) {
            obj.insert("rating".into(), Value::Number(rating));
        }
        Ok(obj)
    }

    /// 完整成员快照逐一核对；历史多余集不能补偿缺失成员。
    async fn bangumi_episodes(&self, main: &anime::Model, snapshot: &bangumi_version::Model, require_complete: bool) -> Result<Option<Vec<Value>>> {
        let members = bangumi_episode_member::Entity::find()
            .filter(bangumi_episode_member::Column::UpstreamBangumiId.eq(&snapshot.upstream_bangumi_id))
            .order_by_asc(bangumi_episode_member::Column::Ordinal).all(&self.db).await?;
        if require_complete {
            if members.len() as i64 != snapshot.expected_episode_count { return Ok(None); }
            let seasons = bangumi_season::Entity::find()
                .filter(bangumi_season::Column::UpstreamBangumiId.eq(&snapshot.upstream_bangumi_id)).all(&self.db).await?;
            for season in seasons {
                let count = members.iter().filter(|m| m.upstream_season_id == season.upstream_season_id).count();
                if count < season.episode_count as usize { return Ok(None); }
            }
        }
        let fields = self.episodes_for(main, None, None).await?;
        let mut episodes = Vec::new();
        for member in members {
            let Some(mut ep) = fields.iter().find(|ep| text(ep,"episodeId").as_deref() == Some(member.upstream_episode_id.as_str())).cloned() else { return Ok(None); };
            ep["seasonId"] = json!(member.upstream_season_id);
            ep["lastWatched"] = json!(member.last_watched);
            episodes.push(ep);
        }
        Ok(Some(episodes))
    }

    async fn episodes_for(&self, main: &anime::Model, season_id: Option<i64>, wanted: Option<&str>) -> Result<Vec<Value>> {
        let mut query = episode::Entity::find().filter(episode::Column::AnimeId.eq(main.id));
        if let Some(id) = season_id { query = query.filter(episode::Column::SeasonId.eq(id)); }
        let mut entries: BTreeMap<String, (String, Map<String, Value>)> = BTreeMap::new();
        for ep in query.all(&self.db).await? {
            let mut value = Map::new();
            value.insert("episodeId".into(), upstream_value(&ep.upstream_episode_id));
            value.insert("episodeTitle".into(), json!(ep.title));
            if let Some(number) = &ep.episode_number { value.insert("episodeNumber".into(), json!(number)); }
            if let Some(description) = ep.type_description { value.insert("typeDescription".into(), json!(description)); }
            if let Some(duration) = ep.duration_seconds { value.insert("durationSeconds".into(), json!(duration)); }
            if let Some(date) = ep.air_date { value.insert("airDate".into(), json!(date)); }
            entries.insert(ep.upstream_episode_id, (ep.episode_number.unwrap_or_default(), value));
        }
        let links = episode_link::Entity::find().filter(episode_link::Column::DandanAnimeId.eq(&main.upstream_anime_id))
            .filter(episode_link::Column::IsManual.eq(true))
            .order_by_asc(episode_link::Column::UpdatedAt).order_by_asc(episode_link::Column::Id).all(&self.db).await?;
        // 人工链接只覆盖已存在的结构化集，不让孤立链接伪造完整性或自动链接遮蔽集表修正。
        for link in links {
            if let Some((number, value)) = entries.get_mut(&link.dandan_episode_id) {
                if let Some(title) = link.episode_title { value.insert("episodeTitle".into(), json!(title)); }
                if let Some(updated) = link.episode_number {
                    *number = updated.clone(); value.insert("episodeNumber".into(), json!(updated));
                }
            }
        }
        let mut entries: Vec<_> = entries.into_iter().filter(|(_, (n,_))| wanted.map_or(true, |w| w == n)).collect();
        entries.sort_by(|(ida,(a,_)),(idb,(b,_))| episode_cmp(a,b).then_with(|| ida.cmp(idb)));
        Ok(entries.into_iter().map(|(_,(_,value))| Value::Object(value)).collect())
    }

    async fn resolve_libraries(&self, keyword: &str) -> Result<Vec<anime::Model>> {
        let norm = normalize(keyword);
        if norm.is_empty() { return Ok(Vec::new()); }
        let (base, requested) = split_season(&norm);
        let aliases = anime_alias::Entity::find().filter(anime_alias::Column::Status.eq("approved"))
            .filter(Condition::any().add(anime_alias::Column::AliasNorm.eq(&norm))
                .add(anime_alias::Column::AliasNormNs.eq(no_spaces(&norm))))
            .order_by_desc(anime_alias::Column::Confidence).limit(20).all(&self.db).await?;
        let exact_ids: HashSet<i64> = aliases.into_iter().map(|a| a.anime_id).collect();
        let mut candidates = if base.is_empty() { Vec::new() } else {
            anime::Entity::find().filter(anime::Column::Title.starts_with(&base))
                .order_by_asc(anime::Column::Id).limit(50).all(&self.db).await?
        };
        // SQL 的大小写规则随后端不同，候选仍须用同一归一化逻辑确认基名。
        let series: Vec<_> = candidates.iter().filter(|a| a.type_code.as_deref() == Some("tvseries")
            && title_base(a.title.as_deref().unwrap_or("")) == base).cloned().collect();
        let related = requested.is_none() && norm == base && base.chars().filter(|c| ('\u{4e00}'..='\u{9fff}').contains(c)).count() >= 4;
        let mut result = if let Some(wanted) = requested {
            series.into_iter().filter(|a| season_number(a.title.as_deref().unwrap_or("")).unwrap_or(1) == wanted).collect::<Vec<_>>()
        } else if related && candidates.len() > 1 {
            std::mem::take(&mut candidates)
        } else if series.len() > 1 && norm == base { series } else { Vec::new() };
        if result.is_empty() && !exact_ids.is_empty() {
            result = anime::Entity::find().filter(anime::Column::Id.is_in(exact_ids)).all(&self.db).await?;
        }
        result.sort_by_key(|a| (a.start_date.clone().unwrap_or_else(|| "9999-12-31".into()),
            season_number(a.title.as_deref().unwrap_or("")).unwrap_or(1), normalize(a.title.as_deref().unwrap_or(""))));
        Ok(result)
    }
}

fn external_name(provider: &str) -> &str {
    match provider {
        "bangumi_tv" => "bangumi.tv", "mal" => "MyAnimeList", "anidb" => "AniDB",
        "anilist" => "AniList", "tmdb" => "TheMovieDB", "imdb" => "IMDb", "tvdb" => "TheTVDB",
        "anisearch" => "AniSearch", "animeplanet" => "Anime-Planet", "notifymoe" => "notify.moe",
        other => other,
    }
}
fn text(v: &Value, key: &str) -> Option<String> {
    let value = v.get(key)?;
    let s = match value { Value::String(s) => s.trim().to_owned(), Value::Number(n) => n.to_string(), _ => return None };
    (!s.is_empty()).then_some(s)
}
fn upstream_value(s: &str) -> Value {
    s.parse::<i64>().map(|v| json!(v)).unwrap_or_else(|_| json!(s))
}
fn normalize(s: &str) -> String { s.nfkc().collect::<String>().to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ") }
fn no_spaces(s: &str) -> String { s.chars().filter(|c| !c.is_whitespace()).collect() }
fn episode_number(ep: &Value, eid: &str, aid: &str) -> Option<String> {
    for key in ["episodeNumber", "episodeIndex", "episodeNo"] {
        if let Some(number) = text(ep, key) { return Some(number); }
    }
    // 只有已知父级标识且后缀完全是数字时才兼容旧上游编码，绝不反推父级。
    eid.strip_prefix(aid).filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()))
        .and_then(|s| s.parse::<u64>().ok()).map(|n| n.to_string())
}
fn episode_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let a = a.trim(); let b = b.trim();
    let digits = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit());
    match (digits(a), digits(b)) {
        (true,true) => {
            let an = a.trim_start_matches('0'); let bn = b.trim_start_matches('0');
            an.len().cmp(&bn.len()).then_with(|| an.cmp(bn))
        },
        (true,false) => std::cmp::Ordering::Less,
        (false,true) => std::cmp::Ordering::Greater,
        _ => a.cmp(b),
    }
}

struct SearchKey { title: String, episodes: bool, episode: Option<String> }
fn parse_key(key: &str) -> Option<SearchKey> {
    // 与缓存入口一致，带片段的目标不得作为结构化查询键。
    if key.contains('#') { return None; }
    let (path, qs) = key.split_once('?')?;
    let episodes = path.ends_with("/api/v2/search/episodes");
    if !episodes && !path.ends_with("/api/v2/search/anime") { return None; }
    let params: Vec<_> = qs.split('&').map(|p| p.split_once('=').unwrap_or((p,""))).collect();
    // 未知参数的语义交给上游，与缓存服务的结构化回源白名单保持一致。
    let mut names = HashSet::new();
    if params.iter().any(|(name, _)| !names.insert(*name) || if episodes {
        !matches!(*name, "anime" | "episode")
    } else {
        !matches!(*name, "keyword" | "anime")
    }) { return None; }
    // Worker 缓存键已经解码，不能再次把 + 或 %xx 当 URL 编码；keyword 与 HTTP 入口保持同一优先级。
    let get = |name: &str| params.iter().find(|(k,_)| *k == name).map(|(_,v)| (*v).to_owned());
    let title = if episodes { get("anime") } else { get("keyword").or_else(|| get("anime")) }?;
    let title = title.trim().to_owned();
    if title.is_empty() { return None; }
    Some(SearchKey { title, episodes, episode: if episodes { get("episode").filter(|s| !s.trim().is_empty()).map(|s|s.trim().to_owned()) } else {None} })
}
fn re(pattern: &str) -> Regex { Regex::new(pattern).expect("静态正则应有效") }
fn chinese_number(s: &str) -> Option<i32> {
    s.parse().ok().or_else(|| match s { "一"=>Some(1),"二"=>Some(2),"三"=>Some(3),"四"=>Some(4),"五"=>Some(5),"六"=>Some(6),"七"=>Some(7),"八"=>Some(8),"九"=>Some(9),"十"=>Some(10),_=>None })
}
fn split_season(s: &str) -> (String, Option<i32>) {
    let mut s = normalize(s); let mut number = None;
    for pattern in [r"第\s*([0-9一二三四五六七八九十]+)\s*季",r"第\s*([0-9一二三四五六七八九十]+)\s*部分",r"season\s*([0-9]+)",r"\bs([0-9]{1,2})\b"] {
        let regex = re(pattern);
        for c in regex.captures_iter(&s) { if number.is_none() { number = chinese_number(&c[1]); } }
        s = regex.replace_all(&s," ").into_owned();
    }
    for pattern in [r"[~～][^~～]*[~～]",r"[^\s]*篇",r"第\s*[0-9一二三四五六七八九十]+\s*章",r"剧场版",r"最终季",r"ova|oad|sp\b"] {
        s = re(pattern).replace_all(&s," ").into_owned();
    }
    s = s.split_whitespace().collect::<Vec<_>>().join(" ").trim_matches([' ', '-', '·', ':', '：']).to_owned();
    if number.is_none() {
        if let Some(c) = re(r"^(.*?)\s+(viii|vii|iii|vi|iv|ii|ix|x|v|i|[1-9][0-9]?)$").captures(&s) {
            number = roman(&c[2]).or_else(|| c[2].parse().ok()); s = c[1].trim().to_owned();
        }
    }
    (s, number)
}
fn roman(s: &str) -> Option<i32> { match s { "i"=>Some(1),"ii"=>Some(2),"iii"=>Some(3),"iv"=>Some(4),"v"=>Some(5),"vi"=>Some(6),"vii"=>Some(7),"viii"=>Some(8),"ix"=>Some(9),"x"=>Some(10),_=>None } }
fn season_number(s: &str) -> Option<i32> {
    let norm = normalize(s);
    for (r,n) in [("viii",8),("vii",7),("iii",3),("vi",6),("iv",4),("ii",2),("ix",9),("v",5)] {
        if re(&format!(r"{}(\s|$)",r)).is_match(&norm) { return Some(n); }
    }
    split_season(&norm).1
}
fn title_base(s: &str) -> String { split_season(s).0 }
fn single_high_season(query: &str, candidate: &str) -> bool {
    let (base, season) = split_season(query);
    season.is_none() && !base.is_empty() && title_base(candidate) == base && season_number(candidate).unwrap_or(1) >= 2
}

/// 所有列表先在同一实体事务内验证并替换，成员清单不借用历史集数。
async fn ingest_bangumi_fields(db: &impl ConnectionTrait, aid: i64, bid: &str, raw: &Value) -> Result<()> {
    let episodes = raw.get("episodes").and_then(Value::as_array)
        .ok_or_else(|| anyhow::anyhow!("番剧详情缺少 episodes 数组"))?;
    let mut unique = HashSet::new();
    for ep in episodes {
        let eid = text(ep,"episodeId").ok_or_else(|| anyhow::anyhow!("详情剧集缺少 episodeId"))?;
        anyhow::ensure!(unique.insert(eid), "详情剧集 episodeId 重复");
    }
    bangumi_episode_member::Entity::delete_many().filter(bangumi_episode_member::Column::UpstreamBangumiId.eq(bid)).exec(db).await?;
    bangumi_season::Entity::delete_many().filter(bangumi_season::Column::UpstreamBangumiId.eq(bid)).exec(db).await?;
    bangumi_title::Entity::delete_many().filter(bangumi_title::Column::UpstreamBangumiId.eq(bid)).exec(db).await?;
    bangumi_version::Entity::delete_by_id(bid).exec(db).await?;
    bangumi_version::ActiveModel { upstream_bangumi_id:Set(bid.into()), anime_id:Set(aid),
        expected_episode_count:Set(raw.get("episodeCount").and_then(Value::as_i64).unwrap_or(i64::try_from(episodes.len())?).max(i64::try_from(episodes.len())?)), }.insert(db).await?;
    for (ordinal, ep) in episodes.iter().enumerate() {
        bangumi_episode_member::ActiveModel {upstream_bangumi_id:Set(bid.into()),ordinal:Set(i64::try_from(ordinal)?),
            upstream_episode_id:Set(text(ep,"episodeId").expect("已校验剧集编号")),
            upstream_season_id:Set(optional_original_text(ep,"seasonId")?),last_watched:Set(optional_original_text(ep,"lastWatched")?),}.insert(db).await?;
    }
    for (ordinal, item) in raw.get("seasons").and_then(Value::as_array).into_iter().flatten().enumerate() {
        let count = item.get("episodeCount").and_then(Value::as_i64).and_then(|n| i32::try_from(n).ok())
            .filter(|n| *n >= 0).ok_or_else(|| anyhow::anyhow!("季度缺少有效 episodeCount"))?;
        bangumi_season::ActiveModel { upstream_bangumi_id:Set(bid.into()),ordinal:Set(i64::try_from(ordinal)?),
            upstream_season_id:Set(optional_original_text(item,"id")?),name:Set(optional_original_text(item,"name")?),
            air_date:Set(optional_original_text(item,"airDate")?),episode_count:Set(count),
            summary:Set(optional_original_text(item,"summary")?),}.insert(db).await?;
    }
    for (ordinal, item) in raw.get("titles").and_then(Value::as_array).into_iter().flatten().enumerate() {
        bangumi_title::ActiveModel {upstream_bangumi_id:Set(bid.into()),ordinal:Set(i64::try_from(ordinal)?),
            title:Set(optional_original_text(item,"title")?),language:Set(optional_original_text(item,"language")?),}.insert(db).await?;
    }
    Ok(())
}
fn optional_original_text(raw: &Value, field: &str) -> Result<Option<String>> {
    match raw.get(field) {None | Some(Value::Null) => Ok(None), Some(Value::String(s)) => Ok(Some(s.clone())),
        _ => anyhow::bail!("字段 {field} 必须为字符串或 null")}
}

async fn upsert_anime(db: &impl ConnectionTrait, aid: &str, raw: &Value, detail: bool) -> Result<anime::Model> {
    let now = Utc::now().naive_utc();
    let old = anime::Entity::find().filter(anime::Column::UpstreamAnimeId.eq(aid)).one(db).await?;
    let exists = old.is_some();
    let mut row = old.map(IntoActiveModel::into_active_model).unwrap_or_else(|| anime::ActiveModel {
        upstream_anime_id:Set(aid.into()),episode_count:Set(0),source:Set(if detail {"bangumi"} else {"search_anime"}.into()),
        first_seen_at:Set(now),created_at:Set(now),..Default::default() });
    if let Some(v) = text(raw,"animeTitle").or_else(||text(raw,"title")) { row.title=Set(Some(v)); }
    if let Some(v) = text(raw,"imageUrl") { row.image_url=Set(Some(v)); }
    if let Some(v) = text(raw,"type") { row.type_code=Set(Some(v)); }
    if let Some(v) = text(raw,"typeDescription") { row.type_description=Set(Some(v)); }
    if let Some(v) = text(raw,"summary") { row.summary=Set(Some(v)); }
    if let Some(v) = text(raw,"rating") { row.rating=Set(Some(v)); }
    if let Some(v) = text(raw,"startDate").or_else(||text(raw,"airDate")) { row.start_date=Set(Some(v)); }
    // 不从分集数组长度推断总集数：单集搜索/残缺数组不是整季完整性的证据。
    if let Some(v) = raw.get("episodeCount").and_then(Value::as_i64).filter(|n| *n > 0 && *n <= i32::MAX as i64) { row.episode_count=Set(v as i32); }
    row.last_seen_at=Set(now); row.updated_at=Set(now);
    Ok(if exists {row.update(db).await?} else {row.insert(db).await?})
}
async fn upsert_season(db: &impl ConnectionTrait, main: &anime::Model, bid: Option<String>, title: Option<String>, raw: &Value) -> Result<season::Model> {
    let now = Utc::now().naive_utc();
    let mut q = season::Entity::find().filter(season::Column::AnimeId.eq(main.id));
    q = if let Some(bid) = &bid {q.filter(season::Column::UpstreamBangumiId.eq(bid))} else {q.filter(season::Column::UpstreamBangumiId.is_null())};
    let old=q.one(db).await?; let exists=old.is_some();
    let mut row=old.map(IntoActiveModel::into_active_model).unwrap_or_else(||season::ActiveModel {anime_id:Set(main.id),upstream_bangumi_id:Set(bid),created_at:Set(now),..Default::default()});
    if title.is_some() { row.title=Set(title.clone()); }
    let number = raw.get("seasonNumber").and_then(Value::as_i64).and_then(|n|i32::try_from(n).ok()).or_else(||title.as_deref().and_then(season_number));
    if number.is_some() {row.season_number=Set(number);}
    if let Some(v)=text(raw,"summary") {row.summary=Set(Some(v));}
    // 季仅维护结构化字段，旧响应关联既不读取也不再设置。
    row.updated_at=Set(now);
    Ok(if exists {row.update(db).await?} else {row.insert(db).await?})
}
async fn upsert_episode(db: &impl ConnectionTrait, aid:i64, sid:Option<i64>, eid:&str, number:Option<String>, raw:&Value, key:&str) -> Result<()> {
    let now=Utc::now().naive_utc();
    let old=episode::Entity::find().filter(episode::Column::UpstreamEpisodeId.eq(eid)).one(db).await?;let exists=old.is_some();
    let mut row=old.map(IntoActiveModel::into_active_model).unwrap_or_else(||episode::ActiveModel {upstream_episode_id:Set(eid.into()),first_seen_at:Set(now),created_at:Set(now),..Default::default()});
    row.anime_id=Set(aid);if sid.is_some(){row.season_id=Set(sid);}
    if number.is_some(){row.episode_number=Set(number);}
    if let Some(v)=text(raw,"episodeTitle"){row.title=Set(Some(v));}
    if let Some(v)=text(raw,"typeDescription"){row.type_description=Set(Some(v));}
    if let Some(v)=text(raw,"airDate"){row.air_date=Set(Some(v));}
    if let Some(v)=raw.get("durationSeconds").and_then(Value::as_i64).and_then(|n|i32::try_from(n).ok()){row.duration_seconds=Set(Some(v));}
    row.source_cache_key=Set(key.into());row.last_seen_at=Set(now);row.updated_at=Set(now);
    if exists {row.update(db).await?;} else {row.insert(db).await?;}Ok(())
}
#[allow(clippy::too_many_arguments)]
async fn upsert_link(db:&impl ConnectionTrait, aid:&str,bid:Option<&str>,eid:&str,title:Option<&str>,number:Option<String>,ep_title:Option<String>,key:&str)->Result<()> {
    let now=Utc::now().naive_utc();
    let old=episode_link::Entity::find().filter(episode_link::Column::DandanEpisodeId.eq(eid))
        .order_by_desc(episode_link::Column::IsManual).order_by_desc(episode_link::Column::Id).one(db).await?;
    if old.as_ref().is_some_and(|r|r.is_manual){return Ok(());}
    let exists=old.is_some();
    let mut row=old.map(IntoActiveModel::into_active_model).unwrap_or_else(||episode_link::ActiveModel {
        local_title:Set(title.unwrap_or("").into()),dandan_episode_id:Set(eid.into()),match_source:Set("bangumi".into()),
        confidence:Set(60),source_cache_key:Set(key.into()),is_manual:Set(false),created_at:Set(now),..Default::default()});
    if number.is_some(){row.episode_number=Set(number);}
    if ep_title.is_some(){row.episode_title=Set(ep_title);}
    row.dandan_anime_id=Set(Some(aid.into()));if let Some(bid)=bid{row.dandan_bangumi_id=Set(Some(bid.into()));}
    if let Some(title)=title{row.anime_title=Set(Some(title.into()));}
    row.bangumi_cache_key=Set(Some(key.into()));row.comment_api_path=Set(Some(format!("/api/v2/comment/{eid}")));
    row.comment_cache_key=Set(Some(format!("comment/{eid}")));row.updated_at=Set(now);
    if exists {row.update(db).await?;}else{row.insert(db).await?;}Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn upsert_alias(db:&impl ConnectionTrait,aid:i64,alias:&str,lang:Option<String>,kind:&str,source:&str,status:&str,confidence:i32)->Result<()> {
    let norm: String=normalize(alias).chars().take(500).collect();if norm.is_empty(){return Ok(());}
    let now=Utc::now().naive_utc();
    let old=anime_alias::Entity::find().filter(anime_alias::Column::AnimeId.eq(aid))
        .filter(anime_alias::Column::AliasNorm.eq(&norm)).one(db).await?;
    if let Some(ref old)=old {if old.source=="manual"||old.verified_by.is_some()||old.confidence>=confidence{return Ok(());}}
    let exists=old.is_some();
    let mut row=old.map(IntoActiveModel::into_active_model).unwrap_or_else(||anime_alias::ActiveModel {
        anime_id:Set(aid),alias:Set(alias.chars().take(500).collect()),alias_norm:Set(norm.clone()),
        alias_norm_ns:Set(Some(no_spaces(&norm))),hit_snapshot:Set(0),created_at:Set(now),..Default::default()});
    row.lang=Set(lang);row.title_type=Set(Some(kind.into()));row.source=Set(source.into());row.status=Set(status.into());
    row.confidence=Set(confidence);row.updated_at=Set(now);
    if exists {
        row.update(db).await?;
    } else {
        // 方言相关的重音/宽度等价与并发插入不能使整笔实体事务回滚。
        anime_alias::Entity::insert(row)
            .on_conflict(sea_orm::sea_query::OnConflict::columns([
                anime_alias::Column::AnimeId, anime_alias::Column::AliasNorm,
            ]).do_nothing().to_owned())
            .exec_without_returning(db).await?;
    }
    Ok(())
}
async fn ingest_titles(db:&impl ConnectionTrait,aid:i64,raw:&Value)->Result<()> {
    let mut items=Vec::new();
    for title in raw.get("titles").and_then(Value::as_array).into_iter().flatten(){
        if let Some(value)=text(title,"title") {
            let language=text(title,"language").unwrap_or_default();
            let kind=if language.contains("主标题"){ "main" }else if language.contains("官方标题"){"official"}else if language.contains("搜索关键词"){"search_keyword"}else{"alias"};
            let lang=[("日语罗马字","ja-romaji"),("简体中文","zh-Hans"),("繁体中文","zh-Hant"),("日语","ja"),("英语","en"),("中文","zh")].into_iter().find(|(k,_)|language.contains(k)).map(|(_,v)|v).unwrap_or("unknown");
            items.push((value,Some(lang.into()),kind));
        }
    }
    for (field,kind) in [("animeTitle","main"),("searchKeyword","search_keyword")] {
        if let Some(value)=text(raw,field){items.push((value,None,kind));}
    }
    let mut seen=HashSet::new();
    for (alias,lang,kind) in items{if seen.insert(normalize(&alias)){upsert_alias(db,aid,&alias,lang,kind,"dandanplay_titles","approved",95).await?;}}
    Ok(())
}
async fn ingest_external_ids(db:&impl ConnectionTrait,aid:i64,raw:&Value)->Result<()> {
    let patterns=[("bangumi_tv",r"bangumi\.tv/subject/(\d+)"),("anidb",r"anidb\.net/anime/(\d+)"),
        ("mal",r"myanimelist\.net/anime/(\d+)"),("anilist",r"anilist\.co/anime/(\d+)"),
        ("tmdb",r"themoviedb\.org/(?:tv|movie)/(\d+)"),("imdb",r"imdb\.com/title/(tt\d+)"),
        ("tvdb",r"thetvdb\.com/dereferrer/series/(\d+)"),("tvdb",r"thetvdb\.com/series/([^/?&\s]+)"),
        ("anisearch",r"anisearch\.com/anime/(\d+)"),("animeplanet",r"anime-planet\.com/anime/([^/?&\s]+)"),
        ("notifymoe",r"notify\.moe/anime/([^/?&\s]+)")];
    let mut databases:Vec<(String,String)>=raw.get("onlineDatabases").and_then(Value::as_array).into_iter().flatten()
        .filter_map(|v|Some((text(v,"name").unwrap_or_default(),text(v,"url")?))).collect();
    if let Some(url)=text(raw,"bangumiUrl"){databases.push(("bangumi.tv".into(),url));}
    let mut seen=HashSet::new();
    for (name,url) in databases {
        let found=patterns.iter().find_map(|(provider,pattern)|re(&format!("(?i){pattern}")).captures(&url).map(|c|((*provider).to_owned(),Some(c[1].to_owned()))));
        let (provider,external_id)=found.unwrap_or_else(|| {
            let lower=name.to_lowercase();let p=match lower.as_str(){"bangumi.tv"=>"bangumi_tv","myanimelist"=>"mal","anime-planet"=>"animeplanet","themoviedb"=>"tmdb","thetvdb"=>"tvdb","notify.moe"=>"notifymoe",other=>other};
            (re("[^a-z0-9]+").replace_all(p,"_").trim_matches('_').to_owned(),None)
        });
        if provider.is_empty()||!seen.insert(provider.clone()){continue;}
        let old=anime_external_id::Entity::find().filter(anime_external_id::Column::AnimeId.eq(aid))
            .filter(anime_external_id::Column::Provider.eq(&provider)).one(db).await?;
        if old.as_ref().is_some_and(|r|r.source=="manual"){continue;}
        let now=Utc::now().naive_utc();let exists=old.is_some();
        let mut row=old.map(IntoActiveModel::into_active_model).unwrap_or_else(||anime_external_id::ActiveModel{anime_id:Set(aid),provider:Set(provider),created_at:Set(now),..Default::default()});
        row.confidence=Set(if external_id.is_some(){95}else{70});row.external_id=Set(external_id);
        row.external_url=Set(Some(url.chars().take(500).collect()));row.source=Set("auto".into());row.updated_at=Set(now);
        if exists{row.update(db).await?;}else{row.insert(db).await?;}
    }
    Ok(())
}

#[cfg(test)]
#[path = "entity_service_tests.rs"]
mod tests;
