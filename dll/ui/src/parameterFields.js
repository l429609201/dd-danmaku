import { groups as basicGroups } from './defaultFields.js'

// 与播放器持久化键保持一致；没有可靠内置值的 URL 不自动填充，避免覆盖播放器版本配置。
const ids = { speed: 'danmakuBaseSpeed' }
const sensitive = key => /token|apikey|secret|password|url|prefix/i.test(key) || key === 'customApiList'
const field = (key, label, value, options) => ({ key, label, value, options,
  id: ids[key] || `danmaku${key[0].toUpperCase()}${key.slice(1)}`,
  sensitive: sensitive(key), type: Array.isArray(value) ? 'json' : typeof value })
export const parameterGroups = basicGroups.map(group => ({ title: group.title,
  fields: group.fields.map(([key, label, value, options, max]) => ({ ...field(key, label, value, Array.isArray(options) ? options : undefined),
    min: typeof options === 'number' ? options : undefined, max })) }))
const add = (title, entries) => parameterGroups.push({ title, fields: entries.map(entry => field(...entry)) })
// 类型和来源字段已由基础分组提供，避免重复提交同键导致后端拒绝保存。
add('时间轴与列表', [
  ['timelineOffset', '时间轴偏移（秒）', 0], ['danmuList', '弹幕列表设置', 0],
])
add('定时', [
  ['timeoutCallbackUnit', '定时单位索引', 1], ['timeoutCallbackValue', '定时值', 0],
])
add('Bangumi', [
  ['bangumiEnable', '启用 Bangumi', false], ['bangumiToken', '个人令牌', ''],
  ['bangumiPostPercent', '观看时长比（1–99）', 95],
  ['bangumiApiPrefix', 'Bangumi API 地址', 'https://api.bgm.tv'],
  ['bgmSearchFallbackEnable', 'BGM 搜索兜底', false],
  ['bangumiImageDomain', 'Bangumi 图片域名', 'https://lain.bgm.tv'],
])
add('TMDB', [
  ['tmdbApiKey', 'TMDB API Key', ''], ['tmdbApiBaseUrl', 'TMDB API 域名', 'https://api.themoviedb.org'],
  ['tmdbEpisodeMappingEnable', '启用集数映射', false],
])
add('弹幕源与匹配', [
  // 与播放器的服务器缓存开关共用持久化键，默认不写入媒体目录。
  ['cacheDanmakuToServer', '缓存弹幕到服务器（需 DLL 在线及写入权限）', false],
  // 服务端读取统一由 DLL 策略控制，不再提供第二个 XML 开关。
  ['useOfficialApi', '使用弹弹play', true],
  ['useCustomApi', '使用自定义 API', false], ['matchApiEnable', '启用 /match 匹配', false],
  ['matchMode', '匹配模式', 'fileNameOnly'], ['appendSeasonEpisode', '文件名拼接季集号', false],
  ['episodeOffsetRules', '集数偏移规则（JSON 数组）', []],
  ['customeCorsProxyUrl', '跨域代理前缀', ''], ['customeDanmakuUrl', '弹幕引擎依赖地址', ''],
  ['customeGetCommentUrl', '获取弹幕 URL 模板', ''], ['customeGetExtcommentUrl', '第三方弹幕 URL 模板', ''],
  ['customePosterImgUrl', '海报 URL 模板', ''], ['customApiPrefix', '自定义 API 地址', ''],
  ['customApiList', '自定义源列表（JSON 数组，可能包含凭据）', []],
  ['apiPriority', 'API 优先级（JSON 数组）', ['official', 'custom']],
])
add('媒体库与黑名单', [
  ['excludedLibraries', '排除媒体库（JSON 数组）', []], ['animeTitleBlacklist', '标题黑名单正则', ''],
  ['episodeTitleBlacklist', '分集名称黑名单正则（未设置时沿用播放器内置）', ''],
  ['blacklistApplyToCustomApi', '黑名单应用于自定义接口', false],
])
add('同步', [
  ['configPersistenceEnable', '启用配置持久化', false], ['configPersistenceAutoSync', '实时同步', false],
  ['configPersistenceNamespace', '同步标识符', 'dd-danmaku'],
])
add('日志与调试', [
  ['consoleLogEnable', '控制台日志', false], ['logLevel', '日志级别', '3'],
  ['debugShowDanmakuWrapper', '弹幕容器边界', false], ['debugShowDanmakuCtrWrapper', '按钮容器边界', false],
  ['debugReverseDanmu', '反转弹幕方向', false], ['debugRandomDanmuColor', '随机弹幕颜色', false],
  ['debugForceDanmuWhite', '强制弹幕白色', false], ['debugGenerateLarge', '测试大量弹幕', false],
  ['debugDialogHyalinize', '透明弹窗背景', false], ['debugDialogWindow', '弹窗窗口化', false],
  ['debugDialogRight', '弹窗靠右布局', false], ['debugTabIframeEnable', '打开内嵌网页', false],
  ['debugH5VideoAdapterEnable', '查看视频适配器', false], ['quickDebugOn', '快速调试', false],
])
export const parameterFields = parameterGroups.flatMap(group => group.fields)

export function parseParameter(field, value) {
  if (field.type === 'boolean') {
    if (!['true', 'false'].includes(value)) throw new Error(`${field.label}必须为布尔值`)
    return value === 'true'
  }
  if (field.type === 'number') {
    const number = Number(value)
    if (!value.trim() || !Number.isFinite(number)) throw new Error(`${field.label}必须为有效数字`)
    return number
  }
  return value
}

export function serializeParameter(field, value) {
  if (field.type === 'json') {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) throw new Error(`${field.label}必须是 JSON 数组`)
    return JSON.stringify(parsed)
  }
  if (field.type === 'number' && (!Number.isFinite(value)
    || (field.min != null && value < field.min) || (field.max != null && value > field.max)))
    throw new Error(`${field.label}超出允许范围`)
  return String(value)
}
