// 番剧和剧集管理 API
import { get, post, put, del } from '@/utils/request'

// ========== 番剧 API ==========

/**
 * 获取番剧列表
 * @param {Object} params - 查询参数
 * @param {number} params.page - 页码
 * @param {number} params.limit - 每页数量
 * @param {string} params.keyword - 搜索关键词
 * @param {string} params.source - 来源（official/bilibili/dandanplay）
 * @returns {Promise<{total: number, list: Array}>}
 */
export function getAnimeList(params) {
  return get('/animes', params)
}

/**
 * 获取番剧详情
 * @param {number} id - 番剧 ID
 * @returns {Promise<Object>}
 */
export function getAnimeDetail(id) {
  return get(`/animes/${id}`)
}

/**
 * 搜索番剧（按标题）
 * @param {string} query - 搜索关键词
 * @param {number} limit - 返回数量限制
 * @returns {Promise<Array>}
 */
export function searchAnime(query, limit = 20) {
  return get('/animes/search', { query, limit })
}

/**
 * 创建番剧
 * @param {Object} data - 番剧数据
 * @returns {Promise<Object>}
 */
export function createAnime(data) {
  return post('/animes', data)
}

/**
 * 更新番剧
 * @param {number} id - 番剧 ID
 * @param {Object} data - 番剧数据
 * @returns {Promise<Object>}
 */
export function updateAnime(id, data) {
  return put(`/animes/${id}`, data)
}

/**
 * 删除番剧
 * @param {number} id - 番剧 ID
 * @returns {Promise<void>}
 */
export function deleteAnime(id) {
  return del(`/animes/${id}`)
}

/**
 * 获取番剧别名列表
 * @param {number} animeId - 番剧 ID
 * @returns {Promise<Array>}
 */
export function getAnimeAliases(animeId) {
  return get(`/animes/${animeId}/aliases`)
}

/**
 * 添加番剧别名
 * @param {number} animeId - 番剧 ID
 * @param {string} alias - 别名
 * @returns {Promise<Object>}
 */
export function addAnimeAlias(animeId, alias) {
  return post(`/animes/${animeId}/aliases`, { alias })
}

/**
 * 删除番剧别名
 * @param {number} animeId - 番剧 ID
 * @param {number} aliasId - 别名 ID
 * @returns {Promise<void>}
 */
export function deleteAnimeAlias(animeId, aliasId) {
  return del(`/animes/${animeId}/aliases/${aliasId}`)
}

/**
 * 获取番剧外部 ID 列表
 * @param {number} animeId - 番剧 ID
 * @returns {Promise<Array>}
 */
export function getAnimeExternalIds(animeId) {
  return get(`/animes/${animeId}/external-ids`)
}

// ========== 剧集 API ==========

/**
 * 获取剧集列表
 * @param {Object} params - 查询参数
 * @param {number} params.animeId - 番剧 ID
 * @param {number} params.page - 页码
 * @param {number} params.limit - 每页数量
 * @returns {Promise<{total: number, list: Array}>}
 */
export function getEpisodeList(params) {
  return get('/episodes', params)
}

/**
 * 获取剧集详情
 * @param {number} id - 剧集 ID
 * @returns {Promise<Object>}
 */
export function getEpisodeDetail(id) {
  return get(`/episodes/${id}`)
}

/**
 * 创建剧集
 * @param {Object} data - 剧集数据
 * @returns {Promise<Object>}
 */
export function createEpisode(data) {
  return post('/episodes', data)
}

/**
 * 更新剧集
 * @param {number} id - 剧集 ID
 * @param {Object} data - 剧集数据
 * @returns {Promise<Object>}
 */
export function updateEpisode(id, data) {
  return put(`/episodes/${id}`, data)
}

/**
 * 删除剧集
 * @param {number} id - 剧集 ID
 * @returns {Promise<void>}
 */
export function deleteEpisode(id) {
  return del(`/episodes/${id}`)
}

/**
 * 获取番剧的所有剧集
 * @param {number} animeId - 番剧 ID
 * @returns {Promise<Array>}
 */
export function getAnimeEpisodes(animeId) {
  return get(`/animes/${animeId}/episodes`)
}

// ========== dandanplay API ==========

/**
 * 视频文件匹配
 * @param {Object} data - 匹配参数
 * @param {string} data.fileName - 文件名
 * @param {string} data.fileHash - 文件哈希（可选）
 * @param {number} data.fileSize - 文件大小（可选）
 * @param {number} data.videoDuration - 视频时长（可选）
 * @returns {Promise<{success: boolean, matches: Array}>}
 */
export function matchVideo(data) {
  return post('/dandanplay/match', data)
}

/**
 * 获取弹幕
 * @param {string} episodeId - 剧集 ID
 * @returns {Promise<{count: number, comments: Array}>}
 */
export function getComments(episodeId) {
  return get(`/dandanplay/comment/${episodeId}`)
}

/**
 * 获取外部弹幕
 * @param {string} url - 弹幕 URL
 * @returns {Promise<{count: number, comments: Array}>}
 */
export function getExtComments(url) {
  return post('/dandanplay/extcomment', { url })
}
