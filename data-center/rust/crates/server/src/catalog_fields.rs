//! 官方 Swagger 目录扩展字段的类型化持久化；未知扩展明确丢弃，不保存 JSON/EAV。
use anyhow::{bail, Result};
use db::entities::{catalog_fields as fields, catalog_metadata as metadata,
    catalog_rating_detail as ratings, catalog_relation as relations,
    catalog_tag as tags, catalog_trailer as trailers};
use sea_orm::{ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, IntoActiveModel,
    QueryFilter, QueryOrder, Set};
use serde_json::{Map, Value};

// 位序固定对应官方字段，不能接受任意字段名作为持久化模式。
const SCALARS: &[&str] = &["bangumiId", "searchKeyword", "isOnAir", "airDay", "isFavorited",
    "isRestricted", "intro", "userRating", "favoriteStatus", "comment"];
const COLLECTIONS: &[&str] = &["metadata", "ratingDetails", "relateds", "similars", "tags", "trailers"];
const INTRO: &[&str] = &["animeId", "bangumiId", "animeTitle", "imageUrl", "searchKeyword",
    "isOnAir", "airDay", "isFavorited", "isRestricted", "rating"];

fn string(v: &Value) -> Result<String> {
    v.as_str().map(str::to_owned).ok_or_else(|| anyhow::anyhow!("官方目录字段需要字符串"))
}
fn boolean(v: &Value) -> Result<bool> {
    v.as_bool().ok_or_else(|| anyhow::anyhow!("官方目录字段需要布尔值"))
}
fn integer(v: &Value) -> Result<i64> {
    v.as_i64().ok_or_else(|| anyhow::anyhow!("官方目录字段需要 int64"))
}
fn int32(v: &Value) -> Result<i32> {
    Ok(i32::try_from(integer(v)?)?)
}
fn decimal(v: &Value) -> Result<f64> {
    v.as_f64().filter(|v| v.is_finite()).ok_or_else(|| anyhow::anyhow!("官方目录评分需要有限数值"))
}
fn favorite(v: &Value) -> Result<String> {
    let value = string(v)?;
    if !["favorited", "finished", "abandoned"].contains(&value.as_str()) {
        bail!("官方目录 favoriteStatus 不属于 Swagger 枚举");
    }
    Ok(value)
}
fn optional<T>(v: &Value, key: &str, parse: fn(&Value) -> Result<T>) -> Result<Option<T>> {
    v.get(key).filter(|v| !v.is_null()).map(parse).transpose()
}
fn mask(v: &Value, names: &[&str]) -> i64 {
    names.iter().enumerate().fold(0, |bits, (i, name)| bits | if v.get(*name).is_some() { 1_i64 << i } else { 0 })
}
fn put<T: Into<Value>>(out: &mut Map<String, Value>, bits: i64, bit: usize, name: &str, value: Option<T>) {
    if bits & (1_i64 << bit) != 0 { out.insert(name.into(), value.map(Into::into).unwrap_or(Value::Null)); }
}
fn array<'a>(v: &'a Value, key: &str) -> Result<Option<&'a Vec<Value>>> {
    match v.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Array(items)) => Ok(Some(items)),
        _ => bail!("官方目录 {key} 需要数组"),
    }
}

/// 接受数据库连接或已有事务；稀疏搜索只更新搜索字段，不抹掉详情。
pub async fn ingest<C: ConnectionTrait>(db: &C, upstream_id: &str, value: &Value, detail: bool) -> Result<()> {
    if !value.is_object() { bail!("官方目录条目需要对象"); }
    let old = fields::Entity::find_by_id(upstream_id).one(db).await?;
    let mut row = old.clone().unwrap_or(fields::Model {
        upstream_anime_id: upstream_id.into(), present: 0, null_collections: 0,
        bangumi_id: None, search_keyword: None, is_on_air: None, air_day: None,
        is_favorited: None, is_restricted: None, intro: None, user_rating: None,
        favorite_status: None, comment: None,
    });
    macro_rules! update {
        ($bit:expr, $key:literal, $field:ident, $parse:ident) => {
            if value.get($key).is_some() {
                row.$field = optional(value, $key, $parse)?;
                row.present |= 1_i64 << $bit;
            }
        };
    }
    update!(0, "bangumiId", bangumi_id, string);
    update!(4, "isFavorited", is_favorited, boolean);
    if detail {
        update!(1, "searchKeyword", search_keyword, string);
        update!(2, "isOnAir", is_on_air, boolean);
        update!(3, "airDay", air_day, int32);
        update!(5, "isRestricted", is_restricted, boolean);
        update!(6, "intro", intro, string);
        update!(7, "userRating", user_rating, int32);
        update!(8, "favoriteStatus", favorite_status, favorite);
        update!(9, "comment", comment, string);
    }
    // 先解析所有子行，再执行写入，避免类型错误导致非事务调用出现半条记录。
    let mut meta_rows = Vec::new();
    let mut rating_rows = Vec::new();
    let mut relation_rows = Vec::new();
    let mut tag_rows = Vec::new();
    let mut trailer_rows = Vec::new();
    if detail {
        for (index, key) in COLLECTIONS.iter().enumerate() {
            if let Some(v) = value.get(*key) {
                row.present |= 1_i64 << (10 + index);
                if v.is_null() { row.null_collections |= 1_i64 << index; }
                else { row.null_collections &= !(1_i64 << index); }
            }
        }
        for (i, v) in array(value, "metadata")?.into_iter().flatten().enumerate() {
            meta_rows.push(metadata::ActiveModel { upstream_anime_id: Set(upstream_id.into()), ordinal: Set(i as i64), value: Set(string(v)?) });
        }
        if let Some(v) = value.get("ratingDetails").filter(|v| !v.is_null()) {
            let map = v.as_object().ok_or_else(|| anyhow::anyhow!("ratingDetails 需要站点评分对象"))?;
            for (site, rating) in map {
                rating_rows.push(ratings::ActiveModel { upstream_anime_id: Set(upstream_id.into()), site: Set(site.clone()), rating: Set(decimal(rating)?) });
            }
        }
        for (kind, key) in [(0, "relateds"), (1, "similars")] {
            for (i, v) in array(value, key)?.into_iter().flatten().enumerate() {
                if !v.is_object() { bail!("{key} 成员需要 BangumiIntro 对象"); }
                relation_rows.push(relations::ActiveModel {
                    upstream_anime_id: Set(upstream_id.into()), relation_kind: Set(kind), ordinal: Set(i as i64),
                    present: Set(mask(v, INTRO)), anime_id: Set(optional(v, "animeId", integer)?),
                    bangumi_id: Set(optional(v, "bangumiId", string)?), anime_title: Set(optional(v, "animeTitle", string)?),
                    image_url: Set(optional(v, "imageUrl", string)?), search_keyword: Set(optional(v, "searchKeyword", string)?),
                    is_on_air: Set(optional(v, "isOnAir", boolean)?), air_day: Set(optional(v, "airDay", int32)?),
                    is_favorited: Set(optional(v, "isFavorited", boolean)?), is_restricted: Set(optional(v, "isRestricted", boolean)?),
                    rating: Set(optional(v, "rating", decimal)?),
                });
            }
        }
        for (i, v) in array(value, "tags")?.into_iter().flatten().enumerate() {
            if !v.is_object() { bail!("tags 成员需要 BangumiTag 对象"); }
            tag_rows.push(tags::ActiveModel { upstream_anime_id: Set(upstream_id.into()), ordinal: Set(i as i64),
                present: Set(mask(v, &["id", "name", "count"])), tag_id: Set(optional(v, "id", int32)?),
                name: Set(optional(v, "name", string)?), count: Set(optional(v, "count", int32)?) });
        }
        for (i, v) in array(value, "trailers")?.into_iter().flatten().enumerate() {
            if !v.is_object() { bail!("trailers 成员需要 BangumiTrailer 对象"); }
            trailer_rows.push(trailers::ActiveModel { upstream_anime_id: Set(upstream_id.into()), ordinal: Set(i as i64),
                present: Set(mask(v, &["id", "url", "title", "imageUrl", "date"])), trailer_id: Set(optional(v, "id", int32)?),
                url: Set(optional(v, "url", string)?), title: Set(optional(v, "title", string)?),
                image_url: Set(optional(v, "imageUrl", string)?), date: Set(optional(v, "date", string)?) });
        }
    }
    let active = row.into_active_model();
    if old.is_some() { active.reset_all().update(db).await?; } else { active.insert(db).await?; }
    if detail {
        // 只替换本次明确出现的集合，缺失集合维持上次详情。
        macro_rules! replace {
            ($key:literal, $entity:ident, $rows:ident) => {
                if value.get($key).is_some() {
                    $entity::Entity::delete_many().filter($entity::Column::UpstreamAnimeId.eq(upstream_id)).exec(db).await?;
                    for item in $rows { item.insert(db).await?; }
                }
            };
        }
        replace!("metadata", metadata, meta_rows);
        replace!("ratingDetails", ratings, rating_rows);
        replace!("tags", tags, tag_rows);
        replace!("trailers", trailers, trailer_rows);
        for (kind, key) in [(0, "relateds"), (1, "similars")] {
            if value.get(key).is_some() {
                relations::Entity::delete_many().filter(relations::Column::UpstreamAnimeId.eq(upstream_id))
                    .filter(relations::Column::RelationKind.eq(kind)).exec(db).await?;
            }
        }
        for item in relation_rows { item.insert(db).await?; }
    }
    Ok(())
}

/// 仅重建白名单字段；主档 rating 由实体服务负责，避免覆盖人工评分。
pub async fn assemble<C: ConnectionTrait>(db: &C, upstream_id: &str, detail: bool) -> Result<Map<String, Value>> {
    let mut out = Map::new();
    let Some(row) = fields::Entity::find_by_id(upstream_id).one(db).await? else { return Ok(out); };
    put(&mut out, row.present, 0, SCALARS[0], row.bangumi_id);
    put(&mut out, row.present, 4, SCALARS[4], row.is_favorited);
    if !detail { return Ok(out); }
    put(&mut out, row.present, 1, SCALARS[1], row.search_keyword);
    put(&mut out, row.present, 2, SCALARS[2], row.is_on_air);
    put(&mut out, row.present, 3, SCALARS[3], row.air_day);
    put(&mut out, row.present, 5, SCALARS[5], row.is_restricted);
    put(&mut out, row.present, 6, SCALARS[6], row.intro);
    put(&mut out, row.present, 7, SCALARS[7], row.user_rating);
    put(&mut out, row.present, 8, SCALARS[8], row.favorite_status);
    put(&mut out, row.present, 9, SCALARS[9], row.comment);
    for (bit, key) in COLLECTIONS.iter().enumerate() {
        if row.present & (1_i64 << (10 + bit)) == 0 { continue; }
        if row.null_collections & (1_i64 << bit) != 0 { out.insert((*key).into(), Value::Null); continue; }
        let items = match *key {
            "metadata" => Value::Array(metadata::Entity::find().filter(metadata::Column::UpstreamAnimeId.eq(upstream_id))
                .order_by_asc(metadata::Column::Ordinal).all(db).await?.into_iter().map(|v| Value::String(v.value)).collect()),
            "ratingDetails" => {
                let mut map = Map::new();
                for v in ratings::Entity::find().filter(ratings::Column::UpstreamAnimeId.eq(upstream_id)).all(db).await? {
                    map.insert(v.site, Value::from(v.rating));
                }
                Value::Object(map)
            },
            "relateds" | "similars" => {
                let kind = if *key == "relateds" { 0 } else { 1 };
                let rows = relations::Entity::find().filter(relations::Column::UpstreamAnimeId.eq(upstream_id))
                    .filter(relations::Column::RelationKind.eq(kind)).order_by_asc(relations::Column::Ordinal).all(db).await?;
                Value::Array(rows.into_iter().map(relation_object).map(Value::Object).collect())
            },
            "tags" => {
                let rows = tags::Entity::find().filter(tags::Column::UpstreamAnimeId.eq(upstream_id)).order_by_asc(tags::Column::Ordinal).all(db).await?;
                Value::Array(rows.into_iter().map(|v| {
                    let mut m = Map::new();
                    put(&mut m, v.present, 0, "id", v.tag_id); put(&mut m, v.present, 1, "name", v.name);
                    put(&mut m, v.present, 2, "count", v.count); Value::Object(m)
                }).collect())
            },
            "trailers" => {
                let rows = trailers::Entity::find().filter(trailers::Column::UpstreamAnimeId.eq(upstream_id)).order_by_asc(trailers::Column::Ordinal).all(db).await?;
                Value::Array(rows.into_iter().map(|v| {
                    let mut m = Map::new();
                    put(&mut m, v.present, 0, "id", v.trailer_id); put(&mut m, v.present, 1, "url", v.url);
                    put(&mut m, v.present, 2, "title", v.title); put(&mut m, v.present, 3, "imageUrl", v.image_url);
                    put(&mut m, v.present, 4, "date", v.date); Value::Object(m)
                }).collect())
            },
            _ => unreachable!("固定官方集合白名单"),
        };
        out.insert((*key).into(), items);
    }
    Ok(out)
}
fn relation_object(v: relations::Model) -> Map<String, Value> {
    let mut m = Map::new();
    put(&mut m, v.present, 0, INTRO[0], v.anime_id); put(&mut m, v.present, 1, INTRO[1], v.bangumi_id);
    put(&mut m, v.present, 2, INTRO[2], v.anime_title); put(&mut m, v.present, 3, INTRO[3], v.image_url);
    put(&mut m, v.present, 4, INTRO[4], v.search_keyword); put(&mut m, v.present, 5, INTRO[5], v.is_on_air);
    put(&mut m, v.present, 6, INTRO[6], v.air_day); put(&mut m, v.present, 7, INTRO[7], v.is_favorited);
    put(&mut m, v.present, 8, INTRO[8], v.is_restricted); put(&mut m, v.present, 9, INTRO[9], v.rating);
    m
}
