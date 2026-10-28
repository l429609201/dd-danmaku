use maxminddb::{geoip2, Reader};
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn};

/// 地理位置点（用于地图展示）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoPoint {
    pub city: String,
    pub country: String,
    pub latitude: f64,
    pub longitude: f64,
    pub count: u64,
}

/// 地理分布响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoDistributionResponse {
    pub available: bool,
    pub points: Vec<GeoPoint>,
    pub total_ips: u64,
    pub cached_at: Option<i64>,
}

/// 城市信息
#[derive(Debug, Clone)]
pub struct CityInfo {
    pub city: String,
    pub country: String,
    pub latitude: f64,
    pub longitude: f64,
}

/// GeoIP 定位服务（MaxMind GeoLite2-City）
/// 
/// 功能：
/// - IP → 城市/经纬度（离线 mmdb 数据库）
/// - 聚合 IP 统计 → ECharts 散点地图
/// - 内存缓存（5 分钟 TTL）
/// - 库文件不存在时优雅降级
pub struct GeoIpService {
    reader: Option<Arc<Reader<Vec<u8>>>>,
    available: bool,
    cache: Arc<RwLock<Option<CachedResult>>>,
}

struct CachedResult {
    data: GeoDistributionResponse,
    cached_at: i64,
}

impl GeoIpService {
    /// 创建 GeoIP 服务
    /// 
    /// 环境变量：
    /// - GEOIP_DB_PATH: /app/config/GeoLite2-City.mmdb
    pub fn new() -> Self {
        let db_path = std::env::var("GEOIP_DB_PATH")
            .unwrap_or_else(|_| "/app/config/GeoLite2-City.mmdb".to_string());
        
        let path = PathBuf::from(&db_path);
        
        if !path.exists() {
            warn!("⚠️  GeoLite2 库不存在: {}，IP 地图降级", db_path);
            return Self {
                reader: None,
                available: false,
                cache: Arc::new(RwLock::new(None)),
            };
        }
        
        match Reader::open_readfile(&path) {
            Ok(reader) => {
                info!("✅ GeoLite2 库已加载: {}", db_path);
                Self {
                    reader: Some(Arc::new(reader)),
                    available: true,
                    cache: Arc::new(RwLock::new(None)),
                }
            },
            Err(e) => {
                warn!("⚠️  GeoLite2 库加载失败: {}，IP 地图降级", e);
                Self {
                    reader: None,
                    available: false,
                    cache: Arc::new(RwLock::new(None)),
                }
            }
        }
    }
    
    /// 是否可用
    pub fn is_available(&self) -> bool {
        self.available
    }
    
    /// 查询单个 IP 的城市信息
    pub fn lookup_city(&self, ip: IpAddr) -> Option<CityInfo> {
        let reader = self.reader.as_ref()?;
        
        let city: geoip2::City = reader.lookup(ip).ok()?;
        
        let city_name = city.city
            .and_then(|c| c.names)
            .and_then(|n| n.get("zh-CN").or_else(|| n.get("en")).map(|s| s.to_string()))
            .unwrap_or_else(|| "Unknown".to_string());
        
        let country_name = city.country
            .and_then(|c| c.names)
            .and_then(|n| n.get("zh-CN").or_else(|| n.get("en")).map(|s| s.to_string()))
            .unwrap_or_else(|| "Unknown".to_string());
        
        let location = city.location?;
        
        Some(CityInfo {
            city: city_name,
            country: country_name,
            latitude: location.latitude?,
            longitude: location.longitude?,
        })
    }
    
    /// 获取地理分布（带缓存，TTL 5 分钟）
    pub async fn get_geo_distribution(&self, db: &sea_orm::DatabaseConnection) -> GeoDistributionResponse {
        if !self.available {
            return GeoDistributionResponse {
                available: false,
                points: vec![],
                total_ips: 0,
                cached_at: None,
            };
        }
        
        // 检查缓存
        let now = chrono::Utc::now().timestamp();
        {
            let cache = self.cache.read().await;
            if let Some(cached) = cache.as_ref() {
                if now - cached.cached_at < 300 {  // 5 分钟 TTL
                    return cached.data.clone();
                }
            }
        }
        
        // 缓存过期，重新计算
        let points = self.aggregate_ip_stats(db).await;
        let total_ips = points.iter().map(|p| p.count).sum();
        
        let response = GeoDistributionResponse {
            available: true,
            points,
            total_ips,
            cached_at: Some(now),
        };
        
        // 更新缓存
        {
            let mut cache = self.cache.write().await;
            *cache = Some(CachedResult {
                data: response.clone(),
                cached_at: now,
            });
        }
        
        response
    }
    
    /// 聚合 IP 统计到地理点
    async fn aggregate_ip_stats(&self, db: &sea_orm::DatabaseConnection) -> Vec<GeoPoint> {
        use sea_orm::*;
        use db::entities::ip_stats;
        
        // 查询最近的 IP 统计（最多 10000 条）
        let stats = match ip_stats::Entity::find()
            .order_by_desc(ip_stats::Column::RequestTime)
            .limit(10000)
            .all(db)
            .await
        {
            Ok(s) => s,
            Err(e) => {
                warn!("⚠️  查询 IP 统计失败: {}", e);
                return vec![];
            }
        };
        
        // IP → 城市 → 计数
        let mut city_counts: std::collections::HashMap<String, (CityInfo, u64)> = std::collections::HashMap::new();
        
        for stat in stats {
            if let Ok(ip) = stat.ip_address.parse::<IpAddr>() {
                if let Some(city_info) = self.lookup_city(ip) {
                    let key = format!("{}|{}", city_info.city, city_info.country);
                    city_counts.entry(key)
                        .and_modify(|(_, count)| *count += 1)
                        .or_insert((city_info, 1));
                }
            }
        }
        
        // 转换为 GeoPoint 并排序（按 count 降序）
        let mut points: Vec<GeoPoint> = city_counts
            .into_iter()
            .map(|(_, (info, count))| GeoPoint {
                city: info.city,
                country: info.country,
                latitude: info.latitude,
                longitude: info.longitude,
                count,
            })
            .collect();
        
        points.sort_by(|a, b| b.count.cmp(&a.count));
        
        // 最多返回 100 个点
        points.truncate(100);
        
        points
    }
    
    /// 清除缓存
    pub async fn clear_cache(&self) {
        let mut cache = self.cache.write().await;
        *cache = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_geoip_service_unavailable() {
        // 测试库文件不存在时的降级
        std::env::set_var("GEOIP_DB_PATH", "/nonexistent/path.mmdb");
        let service = GeoIpService::new();
        assert!(!service.is_available());
    }
    
    #[test]
    fn test_lookup_city_without_reader() {
        std::env::set_var("GEOIP_DB_PATH", "/nonexistent/path.mmdb");
        let service = GeoIpService::new();
        let ip: IpAddr = "8.8.8.8".parse().unwrap();
        assert!(service.lookup_city(ip).is_none());
    }
}
