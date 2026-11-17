//! 规范化实体浏览视图：只读真实业务字段，不读取历史响应快照；管理员鉴权由外层挂载。
use axum::{extract::{Path, Query, State}, http::StatusCode, routing::get, Json, Router};
use db::entities::{anime, bangumi_version, episode};
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, DbErr, EntityTrait, FromQueryResult, Statement};
use serde::Deserialize;
use serde_json::{json, Value};
use crate::AppState;

type ApiResult = Result<Json<Value>, (StatusCode, Json<Value>)>;
fn error(status: StatusCode, message: &str) -> (StatusCode, Json<Value>) { (status, Json(json!({"detail":message}))) }
fn db_error(e: DbErr) -> (StatusCode, Json<Value>) {
    tracing::error!(error=%e, "规范化实体查询失败");
    error(StatusCode::INTERNAL_SERVER_ERROR, "规范化实体查询失败")
}
pub fn routes() -> Router<AppState> {
    Router::new().route("/entities/stats", get(stats)).route("/entities", get(list)).route("/entities/{id}", get(detail))
}
#[derive(Deserialize, Default)]
struct Params { page: Option<u64>, page_size: Option<u64>, r#type: Option<String>, keyword: Option<String> }
fn valid_type(kind: &str) -> bool { matches!(kind, "anime" | "bangumi_version" | "episode") }
fn placeholder(db: &DatabaseConnection, n: usize) -> String { if db.get_database_backend()==DbBackend::Postgres {format!("${n}")} else {"?".into()} }
fn cast_text(db: &DatabaseConnection, expression: &str) -> String { format!("CAST({expression} AS {})",if db.get_database_backend()==DbBackend::MySql {"CHAR"} else {"TEXT"}) }
#[derive(FromQueryResult)]
struct Entry { entity_type: String, pk: String, entity_id: String, title: Option<String>, episode_title: Option<String>, last_seen_at: Option<String>, cache_key: Option<String> }
impl Entry {
    fn value(&self) -> Value {
        // 带类型的定位符避免内部主键、上游 ID 以及不同实体表之间撞号。
        json!({"id":format!("{}:{}",self.entity_type,self.pk),"entity_type":self.entity_type,"entity_id":self.entity_id,"title":self.title,"episode_title":self.episode_title,"api_path":null,"last_seen_at":self.last_seen_at,"cache_key":self.cache_key})
    }
}
fn view_sql(db: &DatabaseConnection) -> String {
    let aid=cast_text(db,"a.id");let eid=cast_text(db,"e.id");
    let at=cast_text(db,"a.last_seen_at");let et=cast_text(db,"e.last_seen_at");
    // 版本表没有独立内部主键或时间戳，保留其真实字符串主键，未知值为 NULL。
    format!("SELECT 'anime' AS entity_type,{aid} AS pk,a.upstream_anime_id AS entity_id,a.title,NULL AS episode_title,{at} AS last_seen_at,NULL AS cache_key FROM animes a UNION ALL SELECT 'bangumi_version',b.upstream_bangumi_id,b.upstream_bangumi_id,a.title,NULL,NULL,NULL FROM bangumi_versions b LEFT JOIN animes a ON a.id=b.anime_id UNION ALL SELECT 'episode',{eid},e.upstream_episode_id,a.title,e.title,{et},NULLIF(e.source_cache_key,'') FROM episodes e LEFT JOIN animes a ON a.id=e.anime_id")
}
async fn stats(State(state): State<AppState>) -> ApiResult {
    let row=state.db.query_one(Statement::from_string(state.db.get_database_backend(),"SELECT (SELECT COUNT(*) FROM animes) AS anime, (SELECT COUNT(*) FROM bangumi_versions) AS bangumi_version, (SELECT COUNT(*) FROM episodes) AS episode".to_string())).await.map_err(db_error)?.ok_or_else(||error(StatusCode::INTERNAL_SERVER_ERROR,"实体统计缺失"))?;
    let anime:i64=row.try_get("","anime").map_err(db_error)?;let bangumi:i64=row.try_get("","bangumi_version").map_err(db_error)?;let episode:i64=row.try_get("","episode").map_err(db_error)?;
    Ok(Json(json!({"data":{"total":anime+bangumi+episode,"types":{"anime":anime,"bangumi_version":bangumi,"episode":episode}}})))
}
async fn list(State(state): State<AppState>, Query(q): Query<Params>) -> ApiResult {
    let page=q.page.unwrap_or(1);let size=q.page_size.unwrap_or(20);
    if page==0 || size==0 || size>200 {return Err(error(StatusCode::BAD_REQUEST,"分页参数无效"));}
    let offset=(page-1).checked_mul(size).filter(|n|*n<=i64::MAX as u64).ok_or_else(||error(StatusCode::BAD_REQUEST,"分页参数溢出"))?;
    let mut filters=vec![];let mut values:Vec<sea_orm::Value>=vec![];
    if let Some(kind)=q.r#type.as_deref().filter(|s|!s.is_empty()) {
        if !valid_type(kind) {return Err(error(StatusCode::BAD_REQUEST,"实体类型无效"));}
        values.push(kind.into());filters.push(format!("entity_type={}",placeholder(&state.db,values.len())));
    }
    if let Some(keyword)=q.keyword.as_deref().map(str::trim).filter(|s|!s.is_empty()) {
        if keyword.chars().count()>500 {return Err(error(StatusCode::BAD_REQUEST,"搜索词过长"));}
        let mut clauses=vec![];
        for column in ["title","episode_title","entity_id"] {values.push(format!("%{keyword}%").into());clauses.push(format!("{column} LIKE {}",placeholder(&state.db,values.len())));}
        filters.push(format!("({})",clauses.join(" OR ")));
    }
    let condition=if filters.is_empty(){String::new()}else{format!(" WHERE {}",filters.join(" AND "))};
    let base=format!("FROM ({}) entities{condition}",view_sql(&state.db));
    let row=state.db.query_one(Statement::from_sql_and_values(state.db.get_database_backend(),format!("SELECT COUNT(*) AS total {base}"),values.clone())).await.map_err(db_error)?.ok_or_else(||error(StatusCode::INTERNAL_SERVER_ERROR,"实体统计缺失"))?;
    let total:i64=row.try_get("","total").map_err(db_error)?;
    let rows=Entry::find_by_statement(Statement::from_sql_and_values(state.db.get_database_backend(),format!("SELECT * {base} ORDER BY entity_type,pk LIMIT {size} OFFSET {offset}"),values)).all(&state.db).await.map_err(db_error)?;
    Ok(Json(json!({"items":rows.iter().map(Entry::value).collect::<Vec<_>>(),"total":total})))
}
async fn detail(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult {
    let (kind,pk)=id.split_once(':').filter(|(kind,pk)|valid_type(kind)&&!pk.is_empty()).ok_or_else(||error(StatusCode::BAD_REQUEST,"实体 ID 必须为类型:主键"))?;
    let missing=||error(StatusCode::NOT_FOUND,"实体不存在");
    let (entry,first_seen_at,fields)=match kind {
        "anime"=>{
            let pk=parse_pk(pk)?;
            let a=anime::Entity::find_by_id(pk).one(&state.db).await.map_err(db_error)?.ok_or_else(missing)?;
            let entry=Entry{entity_type:kind.into(),pk:pk.to_string(),entity_id:a.upstream_anime_id.clone(),title:a.title.clone(),episode_title:None,last_seen_at:Some(a.last_seen_at.to_string()),cache_key:None};
            let fields=json!({"id":a.id,"upstream_anime_id":a.upstream_anime_id,"title":a.title,"image_url":a.image_url,"type_code":a.type_code,"type_description":a.type_description,"summary":a.summary,"rating":a.rating,"start_date":a.start_date,"episode_count":a.episode_count,"source":a.source,"first_seen_at":a.first_seen_at,"last_seen_at":a.last_seen_at,"created_at":a.created_at,"updated_at":a.updated_at});
            (entry,json!(a.first_seen_at),fields)
        },
        "episode"=>{
            let pk=parse_pk(pk)?;
            let e=episode::Entity::find_by_id(pk).one(&state.db).await.map_err(db_error)?.ok_or_else(missing)?;
            let parent=anime::Entity::find_by_id(e.anime_id).one(&state.db).await.map_err(db_error)?;
            let entry=Entry{entity_type:kind.into(),pk:pk.to_string(),entity_id:e.upstream_episode_id.clone(),title:parent.and_then(|a|a.title),episode_title:e.title.clone(),last_seen_at:Some(e.last_seen_at.to_string()),cache_key:(!e.source_cache_key.is_empty()).then(||e.source_cache_key.clone())};
            let fields=json!({"id":e.id,"anime_id":e.anime_id,"season_id":e.season_id,"upstream_episode_id":e.upstream_episode_id,"episode_number":e.episode_number,"title":e.title,"type_description":e.type_description,"duration_seconds":e.duration_seconds,"air_date":e.air_date,"source_cache_key":e.source_cache_key,"first_seen_at":e.first_seen_at,"last_seen_at":e.last_seen_at,"created_at":e.created_at,"updated_at":e.updated_at});
            (entry,json!(e.first_seen_at),fields)
        },
        _=>{
            let b=bangumi_version::Entity::find_by_id(pk.to_string()).one(&state.db).await.map_err(db_error)?.ok_or_else(missing)?;
            let parent=anime::Entity::find_by_id(b.anime_id).one(&state.db).await.map_err(db_error)?;
            let entry=Entry{entity_type:kind.into(),pk:pk.into(),entity_id:b.upstream_bangumi_id.clone(),title:parent.and_then(|a|a.title),episode_title:None,last_seen_at:None,cache_key:None};
            (entry,Value::Null,json!({"upstream_bangumi_id":b.upstream_bangumi_id,"anime_id":b.anime_id,"expected_episode_count":b.expected_episode_count}))
        }
    };
    let mut data=entry.value();data["first_seen_at"]=first_seen_at;data["fields"]=fields;
    Ok(Json(json!({"data":data})))
}
fn parse_pk(value: &str) -> Result<i64,(StatusCode,Json<Value>)> {
    value.parse::<i64>().ok().filter(|n|*n>0).ok_or_else(||error(StatusCode::BAD_REQUEST,"内部主键必须是正整数"))
}
