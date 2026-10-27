// 缓存管理 API
import { get, post, del } from '@/utils/request'

/**
 * 获取 API 响应缓存列表
 * @param {Object} params - 查询参数
 * @param {number} params.page - 页码
 * @param {number} params.limit - 每页数量
 * @param {string} params.keyword - 搜索关键词（缓存键）
 * @param {string} params.source - 来源筛选
 * @returns {Promise<{total: number, list: Array}>}
 */
export function getCacheList(params) {
  return get('/cache', params)
}

/**
 * 获取缓存详情
 * @param {string} key - 缓存键
 * @returns {Promise<Object>}
 */
export function getCacheDetail(key) {
  return get(`/cache/${encodeURIComponent(key)}`)
}

/**
 * 删除缓存
 * @param {string} key - 缓存键
 * @returns {Promise<void>}
 */
export function deleteCache(key) {
  return del(`/cache/${encodeURIComponent(key)}`)
}

/**
 * 批量删除缓存
 * @param {Array<string>} keys - 缓存键列表
 * @returns {Promise<{deleted: number}>}
 */
export function batchDeleteCache(keys) {
  return post('/cache/batch-delete', { keys })
}

/**
 * 清空所有缓存
 * @param {string} source - 可选：只清空指定来源的缓存
 * @returns {Promise<{deleted: number}>}
 */
export function clearAllCache(source) {
  return post('/cache/clear', { source })
}

/**
 * 获取缓存统计信息
 * @returns {Promise<{total: number, bySource: Object, size: number}>}
 */
export function getCacheStats() {
  return get('/cache/stats')
}

/**
 * 刷新缓存（重新获取数据）
 * @param {string} key - 缓存键
 * @returns {Promise<Object>}
 */
export function refreshCache(key) {
  return post(`/cache/${encodeURIComponent(key)}/refresh`)
}

// ========== 弹幕存储 API ==========

/**
 * 获取弹幕存储列表
 * @param {Object} params - 查询参数
 * @param {number} params.page - 页码
 * @param {number} params.limit - 每页数量
 * @param {string} params.keyword - 搜索关键词（剧集 ID）
 * @returns {Promise<{total: number, list: Array}>}
 */
export function getCommentStoreList(params) {
  return get('/comment-store', params)
}

/**
 * 获取弹幕存储详情
 * @param {string} episodeId - 剧集 ID
 * @returns {Promise<Object>}
 */
export function getCommentStoreDetail(episodeId) {
  return get(`/comment-store/${episodeId}`)
}

/**
 * 删除弹幕存储
 * @param {string} episodeId - 剧集 ID
 * @returns {Promise<void>}
 */
export function deleteCommentStore(episodeId) {
  return del(`/comment-store/${episodeId}`)
}

/**
 * 批量删除弹幕存储
 * @param {Array<string>} episodeIds - 剧集 ID 列表
 * @returns {Promise<{deleted: number}>}
 */
export function batchDeleteCommentStore(episodeIds) {
  return post('/comment-store/batch-delete', { episodeIds })
}

/**
 * 清空所有弹幕存储
 * @returns {Promise<{deleted: number}>}
 */
export function clearAllCommentStore() {
  return post('/comment-store/clear')
}

/**
 * 获取弹幕存储统计信息
 * @returns {Promise<{total: number, totalSize: number, totalComments: number}>}
 */
export function getCommentStoreStats() {
  return get('/comment-store/stats')
}

/**
 * 归档弹幕（手动保存）
 * @param {string} episodeId - 剧集 ID
 * @param {Object} data - 弹幕数据
 * @param {number} data.count - 弹幕数量
 * @param {Array} data.comments - 弹幕列表
 * @param {string} data.source - 来源
 * @returns {Promise<void>}
 */
export function archiveComments(episodeId, data) {
  return post(`/comment-store/${episodeId}/archive`, data)
}
