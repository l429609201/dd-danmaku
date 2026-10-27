// 系统配置和管理 API
import { get, post, put } from '@/utils/request'

// ========== 系统配置 ==========

/**
 * 获取系统配置
 * @returns {Promise<Object>}
 */
export function getSystemConfig() {
  return get('/config/system')
}

/**
 * 更新系统配置
 * @param {Object} data - 配置数据
 * @returns {Promise<Object>}
 */
export function updateSystemConfig(data) {
  return put('/config/system', data)
}

/**
 * 获取数据库配置
 * @returns {Promise<Object>}
 */
export function getDatabaseConfig() {
  return get('/config/database')
}

/**
 * 更新数据库配置
 * @param {Object} data - 配置数据
 * @returns {Promise<Object>}
 */
export function updateDatabaseConfig(data) {
  return put('/config/database', data)
}

/**
 * 获取缓存配置
 * @returns {Promise<Object>}
 */
export function getCacheConfig() {
  return get('/config/cache')
}

/**
 * 更新缓存配置
 * @param {Object} data - 配置数据
 * @returns {Promise<Object>}
 */
export function updateCacheConfig(data) {
  return put('/config/cache', data)
}

// ========== 健康检查 ==========

/**
 * 系统健康检查
 * @returns {Promise<{status: string, version: string, uptime: number}>}
 */
export function healthCheck() {
  return get('/health')
}

/**
 * 数据库连接检查
 * @returns {Promise<{connected: boolean, latency: number}>}
 */
export function checkDatabase() {
  return get('/health/database')
}

/**
 * Redis 连接检查
 * @returns {Promise<{connected: boolean, latency: number}>}
 */
export function checkRedis() {
  return get('/health/redis')
}

// ========== 系统信息 ==========

/**
 * 获取系统信息
 * @returns {Promise<Object>}
 */
export function getSystemInfo() {
  return get('/system/info')
}

/**
 * 获取系统统计信息
 * @returns {Promise<Object>}
 */
export function getSystemStats() {
  return get('/system/stats')
}

/**
 * 获取系统版本信息
 * @returns {Promise<{version: string, buildTime: string, gitCommit: string}>}
 */
export function getVersionInfo() {
  return get('/system/version')
}

// ========== 日志管理 ==========

/**
 * 获取系统日志
 * @param {Object} params - 查询参数
 * @param {number} params.page - 页码
 * @param {number} params.limit - 每页数量
 * @param {string} params.level - 日志级别
 * @param {string} params.startTime - 开始时间
 * @param {string} params.endTime - 结束时间
 * @returns {Promise<{total: number, list: Array}>}
 */
export function getSystemLogs(params) {
  return get('/system/logs', params)
}

/**
 * 清空系统日志
 * @param {string} beforeDate - 清空此日期之前的日志
 * @returns {Promise<{deleted: number}>}
 */
export function clearSystemLogs(beforeDate) {
  return post('/system/logs/clear', { beforeDate })
}

// ========== 数据库管理 ==========

/**
 * 获取数据库统计信息
 * @returns {Promise<Object>}
 */
export function getDatabaseStats() {
  return get('/database/stats')
}

/**
 * 获取表统计信息
 * @returns {Promise<Array>}
 */
export function getTableStats() {
  return get('/database/tables')
}

/**
 * 备份数据库
 * @returns {Promise<{path: string, size: number}>}
 */
export function backupDatabase() {
  return post('/database/backup')
}

/**
 * 优化数据库
 * @returns {Promise<{optimized: Array}>}
 */
export function optimizeDatabase() {
  return post('/database/optimize')
}

// ========== 维护任务 ==========

/**
 * 清理过期数据
 * @param {Object} data - 清理配置
 * @param {number} data.days - 保留天数
 * @param {Array<string>} data.tables - 要清理的表
 * @returns {Promise<{deleted: Object}>}
 */
export function cleanupExpiredData(data) {
  return post('/maintenance/cleanup', data)
}

/**
 * 重建索引
 * @param {Array<string>} tables - 要重建索引的表
 * @returns {Promise<{rebuilt: Array}>}
 */
export function rebuildIndexes(tables) {
  return post('/maintenance/rebuild-indexes', { tables })
}

/**
 * 导出数据
 * @param {Object} params - 导出参数
 * @param {string} params.type - 导出类型（sql/json/csv）
 * @param {Array<string>} params.tables - 要导出的表
 * @returns {Promise<{path: string, size: number}>}
 */
export function exportData(params) {
  return post('/maintenance/export', params)
}

/**
 * 导入数据
 * @param {FormData} formData - 包含文件的表单数据
 * @returns {Promise<{imported: number}>}
 */
export function importData(formData) {
  return post('/maintenance/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}
