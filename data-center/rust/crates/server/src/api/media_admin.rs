//! UI 媒体管理仅访问规范化实体；路由鉴权由共享管理路由统一挂载。
use axum::{extract::{Path, Query, State}, http::StatusCode, routing::{get, put, delete}, Json, Router};
use db::entities::{anime, anime_alias as alias, anime_external_id as external};
use sea_orm::{ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, DbErr, EntityTrait, FromQueryResult, IntoActiveModel, QueryFilter, QueryOrder, QuerySelect, QueryTrait, Set, Statement, TransactionTrait};
use serde::Deserialize;
use serde_json::{json, Value};
use unicode_normalization::UnicodeNormalization;
use crate::AppState;

type ApiResult = Result<Json<Value>, (StatusCode, Json<Value>)>;
fn error(status: StatusCode, message: &str) -> (StatusCode, Json<Value>) { (status, Json(json!({"detail":message}))) }
fn db_error(e: DbErr) -> (StatusCode, Json<Value>) {
    tracing::error!(error = %e, "媒体管理数据库操作失败");
    error(StatusCode::INTERNAL_SERVER_ERROR, "媒体数据库操作失败")
}
fn missing() -> (StatusCode, Json<Value>) { error(StatusCode::NOT_FOUND, "媒体或元数据不存在") }
fn clean(value: &str, max: usize) -> Result<String, (StatusCode, Json<Value>)> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max { return Err(error(StatusCode::BAD_REQUEST, "字段为空或超过长度限制")); }
    Ok(value.to_owned())
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/media/library", get(library))
        .route("/media/alias/by-anime", get(aliases_by_anime))
        .route("/media/{anime_id}", get(detail))
        .route("/media/meta/{anime_id}", get(metadata))
        .route("/media/meta/{anime_id}/external-id", put(save_external))
        .route("/media/meta/external-id/{id}", delete(delete_external))
        .route("/media/meta/{anime_id}/alias", put(save_alias))
        .route("/media/meta/alias/{id}/review", put(review_alias))
        .route("/media/meta/alias/{id}/reassign", put(reassign_alias))
        .route("/media/meta/alias/{id}", delete(delete_alias))
}

#[derive(Deserialize, Default)]
struct Page { page: Option<u64>, page_size: Option<u64>, keyword: Option<String>, only_missing: Option<bool>, only_pending: Option<bool> }
impl Page {
    fn bounds(&self) -> Result<(u64,u64), (StatusCode, Json<Value>)> {
        let page=self.page.unwrap_or(1); let size=self.page_size.unwrap_or(24);
        if page==0 || size==0 || size>200 { return Err(error(StatusCode::BAD_REQUEST,"分页参数无效")); }
        let offset=(page-1).checked_mul(size).filter(|n|*n<=i64::MAX as u64).ok_or_else(||error(StatusCode::BAD_REQUEST,"分页参数溢出"))?;
        Ok((size,offset))
    }
}
async fn find_anime(db: &DatabaseConnection, upstream: &str) -> Result<anime::Model,(StatusCode,Json<Value>)> {
    // URL 中的 anime_id 永远是上游标识，不尝试回退到可能撞号的数据库主键。
    anime::Entity::find().filter(anime::Column::UpstreamAnimeId.eq(upstream)).one(db).await.map_err(db_error)?.ok_or_else(missing)
}
fn normalize(value: &str) -> String { value.nfkc().flat_map(char::to_lowercase).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ") }

#[derive(FromQueryResult)]
struct LibraryRow { anime_id:String, title:Option<String>, image_url:Option<String>, type_desc:Option<String>, rating:Option<String>, ep_total:i64, danmaku_count:i64 }
impl LibraryRow {
    fn value(&self) -> Value { json!({"anime_id":self.anime_id,"title":self.title.as_deref().unwrap_or(""),"image_proxy":self.image_url,"type_desc":self.type_desc,"rating":self.rating,"ep_total":self.ep_total,"danmaku_count":self.danmaku_count,"missing_danmaku":self.ep_total-self.danmaku_count,"danmaku_ratio":if self.ep_total>0 {100.0*self.danmaku_count as f64/self.ep_total as f64} else {0.0}}) }
}
// 每个请求先按真实弹幕行聚合，再按路径取最大值，避免不同参数缓存重复计算同一集。
const COVERAGE: &str = "WITH comments AS (SELECT r.api_path, MAX(c.n) AS n FROM structured_responses r JOIN (SELECT request_key,COUNT(*) AS n FROM structured_comments GROUP BY request_key) c ON c.request_key=r.request_key WHERE r.success IS NULL OR r.success=TRUE GROUP BY r.api_path), coverage AS (SELECT e.anime_id, COUNT(*) AS known, SUM(CASE WHEN c.n>0 THEN 1 ELSE 0 END) AS covered FROM episodes e LEFT JOIN comments c ON c.api_path='comment/' || e.upstream_episode_id GROUP BY e.anime_id) ";
pub(crate) fn coverage_sql(backend: sea_orm::DbBackend) -> String {
    // MySQL 的 || 是逻辑或，SUM 整数返回 DECIMAL；显式转为可解码的有符号整数。
    if backend==sea_orm::DbBackend::MySql {
        COVERAGE.replace("'comment/' || e.upstream_episode_id", "CONCAT('comment/',e.upstream_episode_id)")
            .replace("SUM(CASE WHEN c.n>0 THEN 1 ELSE 0 END)", "CAST(SUM(CASE WHEN c.n>0 THEN 1 ELSE 0 END) AS SIGNED)")
    } else { COVERAGE.into() }
}
fn placeholder(db:&DatabaseConnection, n:usize)->String { if db.get_database_backend()==sea_orm::DbBackend::Postgres {format!("${n}")}else{"?".into()} }
async fn library(State(state):State<AppState>, Query(q):Query<Page>) -> ApiResult {
    let (size,offset)=q.bounds()?;
    let mut values:Vec<sea_orm::Value>=vec![];
    let mut filter=String::new();
    if let Some(keyword)=q.keyword.as_deref().filter(|s|!s.trim().is_empty()) {
        let key=format!("%{}%",clean(keyword,500)?); values.push(key.clone().into());values.push(key.into());
        filter=format!(" WHERE (a.title LIKE {} OR EXISTS (SELECT 1 FROM anime_aliases x WHERE x.anime_id=a.id AND x.alias LIKE {}))",placeholder(&state.db,1),placeholder(&state.db,2));
    }
    let base=format!("SELECT a.id,a.upstream_anime_id AS anime_id,a.title,a.image_url,a.type_description AS type_desc,a.rating,CASE WHEN a.episode_count>COALESCE(c.known,0) THEN a.episode_count ELSE COALESCE(c.known,0) END AS ep_total,COALESCE(c.covered,0) AS danmaku_count FROM animes a LEFT JOIN coverage c ON c.anime_id=a.id{filter}");
    let missing_filter=if q.only_missing==Some(true){" WHERE ep_total>danmaku_count"}else{""};
    let sql=format!("{}SELECT COUNT(*) AS n FROM ({base}) media_rows{missing_filter}",coverage_sql(state.db.get_database_backend()));
    let result=state.db.query_one(Statement::from_sql_and_values(state.db.get_database_backend(),sql,values.clone())).await.map_err(db_error)?.ok_or_else(missing)?;
    let total:i64=result.try_get("","n").map_err(db_error)?;
    let sql=format!("{}SELECT * FROM ({base}) media_rows{missing_filter} ORDER BY id LIMIT {size} OFFSET {offset}",coverage_sql(state.db.get_database_backend()));
    let rows=LibraryRow::find_by_statement(Statement::from_sql_and_values(state.db.get_database_backend(),sql,values)).all(&state.db).await.map_err(db_error)?;
    Ok(Json(json!({"items":rows.iter().map(LibraryRow::value).collect::<Vec<_>>(),"total":total})))
}
#[derive(FromQueryResult)]
struct EpisodeRow { episode_id:String,episode_number:Option<String>,episode_title:Option<String>,comment_count:i64 }
async fn detail(State(state):State<AppState>,Path(id):Path<String>)->ApiResult {
    let main=find_anime(&state.db,&id).await?;
    let sql=format!("{}SELECT e.upstream_episode_id AS episode_id,e.episode_number,e.title AS episode_title,COALESCE(c.n,0) AS comment_count FROM episodes e LEFT JOIN comments c ON c.api_path='comment/' || e.upstream_episode_id WHERE e.anime_id={} ORDER BY e.id",coverage_sql(state.db.get_database_backend()),placeholder(&state.db,1));
    let sql=if state.db.get_database_backend()==sea_orm::DbBackend::MySql{sql.replace("'comment/' || e.upstream_episode_id","CONCAT('comment/',e.upstream_episode_id)")}else{sql};
    let episodes=EpisodeRow::find_by_statement(Statement::from_sql_and_values(state.db.get_database_backend(),sql,vec![main.id.into()])).all(&state.db).await.map_err(db_error)?;
    let count=episodes.iter().filter(|e|e.comment_count>0).count() as i64;
    let row=LibraryRow{anime_id:main.upstream_anime_id,title:main.title,image_url:main.image_url,type_desc:main.type_description,rating:main.rating,ep_total:i64::from(main.episode_count).max(episodes.len() as i64),danmaku_count:count};
    let mut data=row.value(); data["summary"]=json!(main.summary);
    data["episodes"]=json!(episodes.iter().map(|e|json!({"episode_id":e.episode_id,"episode_number":e.episode_number,"episode_title":e.episode_title,"comment_count":e.comment_count,"has_danmaku":e.comment_count>0})).collect::<Vec<_>>());
    Ok(Json(json!({"data":data})))
}
fn alias_value(a:&alias::Model)->Value { json!({"id":a.id,"alias":a.alias,"lang":a.lang,"title_type":a.title_type,"source":a.source,"status":a.status,"confidence":a.confidence,"hit":a.hit_snapshot,"ai_suggestion":a.ai_suggestion}) }
fn external_value(e:&external::Model)->Value {json!({"id":e.id,"provider":e.provider,"external_id":e.external_id,"external_url":e.external_url,"source":e.source,"confidence":e.confidence})}
async fn metadata(State(state):State<AppState>,Path(id):Path<String>)->ApiResult {
    let main=find_anime(&state.db,&id).await?;
    let aliases=alias::Entity::find().filter(alias::Column::AnimeId.eq(main.id)).order_by_asc(alias::Column::Id).all(&state.db).await.map_err(db_error)?;
    let ids=external::Entity::find().filter(external::Column::AnimeId.eq(main.id)).order_by_asc(external::Column::Id).all(&state.db).await.map_err(db_error)?;
    Ok(Json(json!({"data":{"external_ids":ids.iter().map(external_value).collect::<Vec<_>>(),"aliases":aliases.iter().map(alias_value).collect::<Vec<_>>()}})))
}
#[derive(Deserialize)]
struct ExternalInput {provider:String,external_id:Option<String>,external_url:Option<String>}
async fn save_external(State(state):State<AppState>,Path(id):Path<String>,Json(input):Json<ExternalInput>)->ApiResult {
    let main=find_anime(&state.db,&id).await?;let provider=clean(&input.provider,100)?;
    let eid=input.external_id.as_deref().map(str::trim).filter(|s|!s.is_empty()).map(|s|clean(s,500)).transpose()?;
    let url=input.external_url.as_deref().map(str::trim).filter(|s|!s.is_empty()).map(|s|clean(s,2048)).transpose()?;
    if eid.is_none() && url.is_none(){return Err(error(StatusCode::BAD_REQUEST,"外部 ID 和 URL 不能同时为空"));}
    if url.as_ref().is_some_and(|s| !(s.starts_with("https://") || s.starts_with("http://"))) {return Err(error(StatusCode::BAD_REQUEST,"外部链接仅支持 HTTP(S)"));}
    let now=chrono::Utc::now().naive_utc();
    let old=external::Entity::find().filter(external::Column::AnimeId.eq(main.id)).filter(external::Column::Provider.eq(&provider)).one(&state.db).await.map_err(db_error)?;
    let exists=old.is_some(); let mut row=old.map(IntoActiveModel::into_active_model).unwrap_or_else(||external::ActiveModel{anime_id:Set(main.id),provider:Set(provider),created_at:Set(now),..Default::default()});
    row.external_id=Set(eid);row.external_url=Set(url);row.source=Set("manual".into());row.confidence=Set(100);row.updated_at=Set(now);
    let row=if exists{row.update(&state.db).await}else{row.insert(&state.db).await}.map_err(db_error)?;
    Ok(Json(json!({"data":external_value(&row)})))
}
#[derive(Deserialize)]
struct AliasInput {alias:String,lang:Option<String>,title_type:Option<String>}
async fn save_alias(State(state):State<AppState>,Path(id):Path<String>,Json(input):Json<AliasInput>)->ApiResult {
    let main=find_anime(&state.db,&id).await?;let text=clean(&input.alias,500)?;let norm=normalize(&text);
    let lang=input.lang.as_deref().map(|s|clean(s,32)).transpose()?;
    let kind=input.title_type.as_deref().map(|s|clean(s,64)).transpose()?;
    let old=alias::Entity::find().filter(alias::Column::AnimeId.eq(main.id)).filter(alias::Column::AliasNorm.eq(&norm)).one(&state.db).await.map_err(db_error)?;
    let now=chrono::Utc::now().naive_utc();let exists=old.is_some();
    let mut row=old.map(IntoActiveModel::into_active_model).unwrap_or_else(||alias::ActiveModel{anime_id:Set(main.id),alias_norm:Set(norm.clone()),alias_norm_ns:Set(Some(norm.chars().filter(|c|!c.is_whitespace()).collect())),hit_snapshot:Set(0),created_at:Set(now),..Default::default()});
    // 人工提交立即生效，沿用 schema 的 source/status 字段，不创建虚构覆盖字段。
    row.alias=Set(text);row.lang=Set(lang);row.title_type=Set(kind);row.source=Set("manual".into());row.status=Set("approved".into());row.confidence=Set(100);row.updated_at=Set(now);
    let row=if exists{row.update(&state.db).await}else{row.insert(&state.db).await}.map_err(db_error)?;
    Ok(Json(json!({"data":alias_value(&row)})))
}
#[derive(Deserialize)]
struct Review {approve:bool}
async fn review_alias(State(state):State<AppState>,Path(id):Path<i64>,claims:Option<axum::Extension<crate::auth::Claims>>,Json(input):Json<Review>)->ApiResult {
    let row=alias::Entity::find_by_id(id).one(&state.db).await.map_err(db_error)?.ok_or_else(missing)?;
    let mut row=row.into_active_model();row.status=Set(if input.approve{"approved"}else{"rejected"}.into());
    // 保存真实审核人，使后续自动同步尊重人工审核；不伪造用户标识。
    if let Some(axum::Extension(claims))=claims {row.verified_by=Set(claims.sub.parse::<i32>().ok());}
    row.updated_at=Set(chrono::Utc::now().naive_utc());
    let row=row.update(&state.db).await.map_err(db_error)?;Ok(Json(json!({"data":alias_value(&row)})))
}
#[derive(Deserialize)]
struct Reassign {target_anime_id:String}
async fn reassign_alias(State(state):State<AppState>,Path(id):Path<i64>,claims:Option<axum::Extension<crate::auth::Claims>>,Json(input):Json<Reassign>)->ApiResult {
    let target=find_anime(&state.db,&input.target_anime_id).await?;
    let txn=state.db.begin().await.map_err(db_error)?;
    let original=alias::Entity::find_by_id(id).one(&txn).await.map_err(db_error)?.ok_or_else(missing)?;
    if alias::Entity::find().filter(alias::Column::AnimeId.eq(target.id)).filter(alias::Column::AliasNorm.eq(&original.alias_norm)).filter(alias::Column::Id.ne(id)).one(&txn).await.map_err(db_error)?.is_some(){return Err(error(StatusCode::CONFLICT,"目标媒体已存在相同别名"));}
    let now=chrono::Utc::now().naive_utc();
    let reviewer=claims.and_then(|axum::Extension(c)|c.sub.parse::<i32>().ok());
    let mut moved=original.clone().into_active_model();
    moved.anime_id=Set(target.id);moved.source=Set("manual".into());moved.status=Set("approved".into());moved.confidence=Set(100);moved.updated_at=Set(now);
    if let Some(reviewer)=reviewer {moved.verified_by=Set(Some(reviewer));}
    let moved=moved.update(&txn).await.map_err(db_error)?;
    if original.anime_id!=target.id {
        // 同一事务保留旧归属的人工拒绝决定；现有摄取按 anime_id+alias_norm 查找并尊重 manual。
        // 必须先移动再插入，才能满足现有 uq_alias_anime_norm；schema 没有 verified_at，仅使用 updated_at。
        let mut rejected=original.into_active_model();rejected.id=sea_orm::ActiveValue::NotSet;
        rejected.source=Set("manual".into());rejected.status=Set("rejected".into());rejected.confidence=Set(100);
        rejected.created_at=Set(now);rejected.updated_at=Set(now);
        if let Some(reviewer)=reviewer {rejected.verified_by=Set(Some(reviewer));}
        rejected.insert(&txn).await.map_err(db_error)?;
    }
    txn.commit().await.map_err(db_error)?;
    Ok(Json(json!({"data":alias_value(&moved)})))
}
async fn delete_alias(State(state):State<AppState>,Path(id):Path<i64>)->ApiResult {if alias::Entity::delete_by_id(id).exec(&state.db).await.map_err(db_error)?.rows_affected==0{return Err(missing());}Ok(Json(json!({"success":true})))}
async fn delete_external(State(state):State<AppState>,Path(id):Path<i64>)->ApiResult {if external::Entity::delete_by_id(id).exec(&state.db).await.map_err(db_error)?.rows_affected==0{return Err(missing());}Ok(Json(json!({"success":true})))}

async fn aliases_by_anime(State(state):State<AppState>,Query(q):Query<Page>)->ApiResult {
    use sea_orm::{Condition, PaginatorTrait};
    let (size,offset)=q.bounds()?;
    let mut query=anime::Entity::find();
    if let Some(keyword)=q.keyword.as_deref().filter(|s|!s.trim().is_empty()){let key=format!("%{}%",clean(keyword,500)?);let matched=alias::Entity::find().select_only().column(alias::Column::AnimeId).filter(alias::Column::Alias.like(&key)).into_query(); query=query.filter(Condition::any().add(anime::Column::Title.like(&key)).add(anime::Column::Id.in_subquery(matched)));}
    if q.only_pending==Some(true){query=query.filter(anime::Column::Id.in_subquery(alias::Entity::find().select_only().column(alias::Column::AnimeId).filter(alias::Column::Status.eq("pending")).into_query()));}
    let total=query.clone().count(&state.db).await.map_err(db_error)?;
    let mains=query.order_by_asc(anime::Column::Id).limit(size).offset(offset).all(&state.db).await.map_err(db_error)?;
    let ids:Vec<i64>=mains.iter().map(|a|a.id).collect();let mut items=vec![];
    let aliases=alias::Entity::find().filter(alias::Column::AnimeId.is_in(ids.clone())).order_by_asc(alias::Column::Id).all(&state.db).await.map_err(db_error)?;
    let external_ids=external::Entity::find().filter(external::Column::AnimeId.is_in(ids)).order_by_asc(external::Column::Id).all(&state.db).await.map_err(db_error)?;
    for a in mains {let mut links=serde_json::Map::new();for e in external_ids.iter().filter(|e|e.anime_id==a.id){if let Some(url)=&e.external_url{links.insert(e.provider.clone(),json!(url));}}
        items.push(json!({"anime_id":a.upstream_anime_id,"title":a.title.as_deref().unwrap_or(""),"image_url":a.image_url,"links":links,"approved":aliases.iter().filter(|x|x.anime_id==a.id&&x.status=="approved").map(alias_value).collect::<Vec<_>>(),"pending":aliases.iter().filter(|x|x.anime_id==a.id&&x.status=="pending").map(alias_value).collect::<Vec<_>>() }));}
    Ok(Json(json!({"items":items,"total":total})))
}
