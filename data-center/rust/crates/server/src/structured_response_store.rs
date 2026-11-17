//! 官方 match/comment 的规范化持久化；JSON 仅用于边界解析与响应组装，不落库。
use db::entities::{structured_comment as comment, structured_match as candidate, structured_response as response};
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, IntoActiveModel, QueryFilter, QueryOrder, TransactionTrait};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

const META: &[&str] = &["success", "errorCode", "errorMessage", "isMatched", "count"];
const MATCH: &[&str] = &["animeId", "episodeId", "animeTitle", "episodeTitle", "type", "typeDescription", "shift", "imageUrl"];
const COMMENT: &[&str] = &["cid", "p", "m"];

#[derive(Clone)]
pub struct StructuredResponseStore { db: DatabaseConnection }
impl StructuredResponseStore {
    pub fn new(db: DatabaseConnection) -> Self { Self { db } }

    /// 完整 query（含重复参数）和完整 payload 都进入摘要；键中不暴露请求或凭据。
    pub fn request_key(path: &str, query: Option<&str>, payload: Option<&Value>) -> String {
        let context = serde_json::to_vec(&(path, query, payload)).expect("JSON 值可序列化");
        format!("structured-v1:{:x}", Sha256::digest(context))
    }

    pub async fn get(&self, path: &str, key: &str) -> anyhow::Result<Option<Value>> {
        // 同一个事务读取元数据和行集合，避免替换过程中混合两个版本。
        let txn = self.db.begin().await?;
        let Some(meta) = response::Entity::find_by_id(key).one(&txn).await? else { return Ok(None); };
        if meta.api_path != path || meta.expires_at <= chrono::Utc::now().naive_utc() { return Ok(None); }
        let mut out = Map::new();
        emit(&mut out, META, meta.present_fields, vec![val(meta.success), val(meta.error_code), val(meta.error_message), val(meta.is_matched), val(meta.comment_count)]);
        let rows = if path == "match" {
            candidate::Entity::find().filter(candidate::Column::RequestKey.eq(key))
                .order_by_asc(candidate::Column::Ordinal).all(&txn).await?.into_iter().map(|row| {
                    let mut item = Map::new();
                    emit(&mut item, MATCH, row.present_fields, vec![val(row.anime_id), val(row.episode_id), val(row.anime_title), val(row.episode_title), val(row.anime_type), val(row.type_description), val(row.shift), val(row.image_url)]);
                    Value::Object(item)
                }).collect()
        } else if (path.starts_with("comment/") || path == "extcomment") {
            comment::Entity::find().filter(comment::Column::RequestKey.eq(key))
                .order_by_asc(comment::Column::Ordinal).all(&txn).await?.into_iter().map(|row| {
                    let p = assemble_p(&row)?;
                    let mut item = Map::new();
                    emit(&mut item, COMMENT, row.present_fields, vec![Value::from(row.cid), p, val(row.m)]);
                    Ok(Value::Object(item))
                }).collect::<anyhow::Result<Vec<_>>>()?
        } else { anyhow::bail!("不支持的结构化接口"); };
        out.insert(if path == "match" { "matches" } else { "comments" }.into(), Value::Array(rows));
        txn.commit().await?;
        Ok(Some(Value::Object(out)))
    }

    /// 失败对象返回 None；成功必须先完整验证再事务替换，返回值只从表字段重建。
    /// 未支持的扩展字段明确舍弃并记录字段数量，不保存任意 JSON 兜底。
    pub async fn ingest(&self, path: &str, key: &str, value: &Value) -> anyhow::Result<Option<Value>> {
        let object = value.as_object().ok_or_else(|| anyhow::anyhow!("上游响应必须为对象"))?;
        if object.get("success") == Some(&Value::Bool(false)) { return Ok(None); }
        if object.get("errorCode").is_some_and(|v| v.as_i64() != Some(0)) { return Ok(None); }
        let is_match = path == "match";
        anyhow::ensure!(is_match || (path.starts_with("comment/") || path == "extcomment"), "不支持的结构化接口");
        let field = if is_match { "matches" } else { "comments" };
        let rows = object.get(field).and_then(Value::as_array).ok_or_else(|| anyhow::anyhow!("上游响应缺少 {field} 数组"))?;
        let meta = response::Model {
            request_key: key.into(), api_path: path.into(), present_fields: mask(object, META),
            success: boolean(object, "success")?, error_code: integer(object, "errorCode")?,
            error_message: text(object, "errorMessage")?, is_matched: if is_match { boolean(object, "isMatched")? } else { None },
            comment_count: if is_match { None } else { integer(object, "count")? },
            expires_at: chrono::Utc::now().naive_utc() + chrono::Duration::seconds(if is_match { 86400 } else { 43200 }),
        };
        anyhow::ensure!(!is_match || meta.is_matched.is_some(), "匹配响应缺少 isMatched 布尔值");
        anyhow::ensure!(is_match || meta.comment_count.is_some(), "弹幕响应缺少 count 整数");
        // 分支特有字段不应跨协议泄漏，即使上游误带了同名扩展字段。
        let mut meta = meta;
        meta.present_fields &= if is_match { 0b01111 } else { 0b10111 };
        let mut matches = Vec::new();
        let mut comments = Vec::new();
        warn_unknown(object, META, Some(field));
        for (ordinal, value) in rows.iter().enumerate() {
            let item = value.as_object().ok_or_else(|| anyhow::anyhow!("响应行必须为对象"))?;
            if is_match {
                let anime_id = integer(item, "animeId")?;
                let episode_id = integer(item, "episodeId")?;
                anyhow::ensure!(anime_id.is_some() && episode_id.is_some(), "匹配行缺少 animeId/episodeId 整数");
                matches.push(candidate::Model { request_key: key.into(), ordinal: ordinal as i64,
                    present_fields: mask(item, MATCH), anime_id, episode_id,
                    anime_title: text(item, "animeTitle")?, episode_title: text(item, "episodeTitle")?,
                    anime_type: text(item, "type")?, type_description: text(item, "typeDescription")?,
                    shift: number(item, "shift")?, image_url: text(item, "imageUrl")? });
                warn_unknown(item, MATCH, None);
            } else {
                let cid = integer(item, "cid")?.ok_or_else(|| anyhow::anyhow!("弹幕行缺少 cid 整数"))?;
                let p = text(item, "p")?;
                let (time_seconds, mode, color, user_id) = match p.as_deref() {
                    Some(p) => {
                        let (time, mode, color, user) = parse_p(p)?;
                        (Some(time), Some(mode), Some(color), Some(user))
                    }
                    None => (None, None, None, None),
                };
                comments.push(comment::Model { request_key: key.into(), ordinal: ordinal as i64,
                    present_fields: mask(item, COMMENT), cid, p_is_null: p.is_none(),
                    time_seconds, mode, color, user_id, m: text(item, "m")? });
                warn_unknown(item, COMMENT, None);
            }
        }
        let txn = self.db.begin().await?;
        candidate::Entity::delete_many().filter(candidate::Column::RequestKey.eq(key)).exec(&txn).await?;
        comment::Entity::delete_many().filter(comment::Column::RequestKey.eq(key)).exec(&txn).await?;
        response::Entity::delete_by_id(key).exec(&txn).await?;
        meta.into_active_model().insert(&txn).await?;
        for row in matches { row.into_active_model().insert(&txn).await?; }
        for row in comments { row.into_active_model().insert(&txn).await?; }
        txn.commit().await?;
        self.get(path, key).await
    }
}

/// 官方协议顺序为出现时间、模式、颜色、用户 ID；不是 B 站 XML 的属性顺序。
fn parse_p(p: &str) -> anyhow::Result<(f64, i32, i64, String)> {
    let parts: Vec<&str> = p.split(',').collect();
    anyhow::ensure!(parts.len() == 4, "弹幕 p 必须为时间、模式、颜色、用户 ID 四段");
    let time = parts[0].parse::<f64>().map_err(|_| anyhow::anyhow!("弹幕时间必须为数字"))?;
    anyhow::ensure!(time.is_finite(), "弹幕时间必须为有限数值");
    let mode = parts[1].parse::<i32>().map_err(|_| anyhow::anyhow!("弹幕模式必须为 i32 整数"))?;
    let color = parts[2].parse::<i64>().map_err(|_| anyhow::anyhow!("弹幕颜色必须为整数"))?;
    Ok((time, mode, color, parts[3].to_owned()))
}

fn assemble_p(row: &comment::Model) -> anyhow::Result<Value> {
    if row.p_is_null || row.present_fields & 2 == 0 { return Ok(Value::Null); }
    let (Some(time), Some(mode), Some(color), Some(user)) =
        (row.time_seconds, row.mode, row.color, row.user_id.as_deref()) else {
            anyhow::bail!("结构化弹幕 p 字段不完整");
        };
    anyhow::ensure!(time.is_finite() && !user.contains(','), "结构化弹幕 p 字段无效");
    // 仅保留一个数值真源；12.340 重建为 12.34 不改变弹幕业务时间。
    Ok(Value::String(format!("{time},{mode},{color},{user}")))
}

fn mask(object: &Map<String, Value>, names: &[&str]) -> i64 {
    names.iter().enumerate().fold(0, |mask, (i, name)| mask | if object.contains_key(*name) { 1 << i } else { 0 })
}
fn emit(out: &mut Map<String, Value>, names: &[&str], mask: i64, values: Vec<Value>) {
    for (i, (name, value)) in names.iter().zip(values).enumerate() { if mask & (1 << i) != 0 { out.insert((*name).into(), value); } }
}
fn val<T: serde::Serialize>(value: Option<T>) -> Value { serde_json::to_value(value).expect("标量可序列化") }
fn text(object: &Map<String, Value>, name: &str) -> anyhow::Result<Option<String>> {
    match object.get(name) { None | Some(Value::Null) => Ok(None), Some(Value::String(v)) => Ok(Some(v.clone())), _ => anyhow::bail!("字段 {name} 必须为字符串或 null") }
}
fn integer(object: &Map<String, Value>, name: &str) -> anyhow::Result<Option<i64>> {
    match object.get(name) { None | Some(Value::Null) => Ok(None), Some(v) => v.as_i64().map(Some).ok_or_else(|| anyhow::anyhow!("字段 {name} 必须为 i64 整数")) }
}
fn boolean(object: &Map<String, Value>, name: &str) -> anyhow::Result<Option<bool>> {
    match object.get(name) { None | Some(Value::Null) => Ok(None), Some(v) => v.as_bool().map(Some).ok_or_else(|| anyhow::anyhow!("字段 {name} 必须为布尔值")) }
}
fn number(object: &Map<String, Value>, name: &str) -> anyhow::Result<Option<f64>> {
    match object.get(name) { None | Some(Value::Null) => Ok(None), Some(v) => v.as_f64().map(Some).ok_or_else(|| anyhow::anyhow!("字段 {name} 必须为数字")) }
}
fn warn_unknown(object: &Map<String, Value>, fields: &[&str], list: Option<&str>) {
    let count = object.keys().filter(|key| !fields.contains(&key.as_str()) && list != Some(key.as_str())).count();
    if count > 0 { tracing::warn!(count, "结构化响应已省略不支持的上游扩展字段"); }
}
