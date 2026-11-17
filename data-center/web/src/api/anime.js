// 媒体 API：只适配 Rust 当前真实提供的契约，不把链接、别名等旧能力映射成普通 CRUD。
import { apiV2 } from '../utils/api.js'

const unsupported = (feature) => Promise.reject(new Error(`当前 Rust 后端尚未实现${feature}，未发送请求`))
const pathId = (id) => encodeURIComponent(String(id))

// Rust 分页使用 page_size；保留旧 limit 入参，并向旧调用方提供 list 别名。
export async function getAnimeList(params = {}) {
  if (params.source) return unsupported('按媒体来源筛选')
  const q = new URLSearchParams({ page: params.page ?? 1, page_size: params.page_size ?? params.limit ?? 20 })
  const keyword = String(params.keyword ?? '').trim()
  if (keyword) q.set('q', keyword)
  const res = await apiV2(`/media/animes${keyword ? '/search' : ''}?${q}`)
  return { ...res, list: res.animes }
}

// 详情保留 Rust 的 { anime, episodes, total_episodes }，不伪造弹幕覆盖信息。
export const getAnimeDetail = (id) => apiV2(`/media/animes/${pathId(id)}`)
export const searchAnime = (query, limit = 20) => String(query ?? '').trim()
  ? getAnimeList({ keyword: query, limit })
  : Promise.reject(new Error('搜索关键词不能为空'))
export const createAnime = (data) => apiV2('/media/animes', { method: 'POST', body: data })
export const updateAnime = (id, data) => apiV2(`/media/animes/${pathId(id)}`, { method: 'PUT', body: data })
export const deleteAnime = (id) => apiV2(`/media/animes/${pathId(id)}`, { method: 'DELETE' })

// 元数据 URL 使用 upstream_anime_id（上游字符串标识），不是普通 CRUD 的数据库 PK。
export const getAnimeAliases = async (upstreamAnimeId) => (await apiV2(`/media/meta/${pathId(upstreamAnimeId)}`)).data.aliases
export const addAnimeAlias = (upstreamAnimeId, alias) => apiV2(`/media/meta/${pathId(upstreamAnimeId)}/alias`, { method: 'PUT', body: { alias } })
export const deleteAnimeAlias = (_upstreamAnimeId, aliasId) => apiV2(`/media/meta/alias/${pathId(aliasId)}`, { method: 'DELETE' })
export const getAnimeExternalIds = async (upstreamAnimeId) => (await apiV2(`/media/meta/${pathId(upstreamAnimeId)}`)).data.external_ids

export async function getEpisodeList(params = {}) {
  if (params.animeId != null || params.anime_id != null) {
    // by-anime 返回全部分集，不能冒充已执行分页；需要分页时显式拒绝。
    return unsupported('按番剧筛选的分页分集列表（可使用 getAnimeEpisodes 获取全部）')
  }
  const q = new URLSearchParams({ page: params.page ?? 1, page_size: params.page_size ?? params.limit ?? 20 })
  const res = await apiV2(`/media/episodes?${q}`)
  return { ...res, list: res.episodes }
}
export const getEpisodeDetail = (id) => apiV2(`/media/episodes/${pathId(id)}`)
export const createEpisode = (data) => apiV2('/media/episodes', { method: 'POST', body: data })
export const updateEpisode = (id, data) => apiV2(`/media/episodes/${pathId(id)}`, { method: 'PUT', body: data })
export const deleteEpisode = (id) => apiV2(`/media/episodes/${pathId(id)}`, { method: 'DELETE' })
export const getAnimeEpisodes = (animeId) => apiV2(`/media/episodes/by-anime?${new URLSearchParams({ anime_id: animeId })}`)

// 公共弹幕 API 只在 Rust API 模式开放；非 API 模式由后端返回明确错误。
export const matchVideo = (data) => apiV2('/match', { method: 'POST', body: data })
export const getComments = (episodeId) => apiV2(`/comment/${pathId(episodeId)}`)
export const getExtComments = (url) => apiV2('/extcomment', { method: 'POST', body: { url } })
