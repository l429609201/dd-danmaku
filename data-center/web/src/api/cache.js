// Rust 缓存管理：响应缓存按数据库行 ID 定位，不将旧 cache_key 当成行 ID。
import { apiV2 } from '../utils/api.js'

const unsupported = (feature) => Promise.reject(new Error(`当前 Rust 后端尚未实现${feature}，未发送请求`))
const cacheId = (id) => {
  if (!/^\d+$/.test(String(id)) || Number(id) <= 0) throw new Error('响应缓存操作需要正整数行 ID，不能使用缓存键')
  return encodeURIComponent(String(id))
}
const episodePath = (episodeId) => `/comment-store/entries/${encodeURIComponent(String(episodeId))}`

// 支持旧 limit 入参，实际发送 Rust 的 page_size；不静默忽略旧来源筛选。
export async function getCacheList(params = {}) {
  const { limit, ...query } = params
  if (query.source) return unsupported('按缓存来源筛选')
  const q = new URLSearchParams(Object.entries({ ...query, page: query.page ?? 1, page_size: query.page_size ?? limit ?? 20 })
    .filter(([, value]) => value != null && value !== ''))
  const res = await apiV2(`/cache/responses?${q}`)
  return { ...res, list: res.items }
}
export const getCacheDetail = (id) => apiV2(`/cache/responses/${cacheId(id)}`)
export const deleteCache = (id) => apiV2(`/cache/responses/${cacheId(id)}`, { method: 'DELETE' })
export const getCacheStats = () => apiV2('/cache/stats')
// 旧 refreshCache 声称重新拉取，而 Rust 只支持标记；不能假映射这两种语义。
export const refreshCache = () => unsupported('主动重新获取缓存（可改用 markCacheRefresh 标记）')
export const markCacheRefresh = (id) => apiV2(`/cache/responses/${cacheId(id)}/mark-refresh`, { method: 'POST' })
export const batchDeleteCache = () => unsupported('批量删除响应缓存')
export const clearAllCache = () => unsupported('清空全部响应缓存')

export async function getCommentStoreList(params = {}) {
  const { limit, ...query } = params
  const q = new URLSearchParams(Object.entries({ ...query, page: query.page ?? 1, page_size: query.page_size ?? limit ?? 20 })
    .filter(([, value]) => value != null && value !== ''))
  const res = await apiV2(`/comment-store/entries?${q}`)
  return { ...res, list: res.items }
}
export const getCommentStoreDetail = (episodeId) => apiV2(`${episodePath(episodeId)}?offset=0&limit=100`)
// 后端仅允许删除规范化记录；旧文件存储明确返回 501，不进行磁盘删除。
export const deleteCommentStore = (episodeId) => apiV2(episodePath(episodeId), { method: 'DELETE' })
export const getCommentStoreStats = () => apiV2('/comment-store/stats')
export const batchDeleteCommentStore = () => unsupported('批量删除弹幕存储')
export const clearAllCommentStore = () => unsupported('清空全部弹幕存储')
export const archiveComments = () => unsupported('手动归档弹幕')
