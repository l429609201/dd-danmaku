// 系统管理契约与 Rust router_modes 对齐；缺失能力不可假映射为其他功能。
import { apiV2 } from '../utils/api.js'

const unavailable = (feature) => Promise.reject(new Error(`Rust 后端尚未提供${feature}接口`))

/** 返回 {configs,total}；写入必须为 {configs:[{namespace,key,value}]}。 */
export function getSystemConfig() { return apiV2('/settings') }
export function updateSystemConfig(data) {
  return apiV2('/settings', { method: 'PUT', body: data })
}
export function getDatabaseConfig() { return apiV2('/settings/database') }
export function updateDatabaseConfig() { return unavailable('修改数据库连接配置') }
export function getCacheConfig() { return apiV2('/settings/cache') }
export function updateCacheConfig() { return unavailable('修改缓存运行配置') }

/** 返回 {status,database,cache,storage,timestamp}，各探针保留 unknown 状态。 */
export function healthCheck() { return apiV2('/settings/health') }
export async function checkDatabase() {
  const health = await healthCheck()
  return health.database
}
// SQL 缓存探针不等于 Redis 健康探针。
export function checkRedis() { return unavailable('Redis 健康探针') }
export function getSystemInfo() { return apiV2('/dashboard/system') }
export function getSystemStats() { return apiV2('/dashboard/stats') }
export function getVersionInfo() { return apiV2('/dashboard/system') }
// 系统日志不等于 Worker 日志，不跨语义映射。
export function getSystemLogs() { return unavailable('系统日志查询') }
export function clearSystemLogs() { return unavailable('清空系统日志') }

export function getDatabaseStats() { return apiV2('/dashboard/db-stats') }
export async function getTableStats() {
  const stats = await getDatabaseStats()
  return stats.sql.tables
}
export function backupDatabase() { return unavailable('数据库备份') }
export function optimizeDatabase() { return unavailable('数据库优化') }
export function cleanupExpiredData() { return unavailable('按表和保留天数清理数据') }
export function rebuildIndexes() { return unavailable('重建数据库索引') }
export function exportData() { return unavailable('导出数据库') }
export function importData() { return unavailable('导入数据库') }
