import { parameterFields } from './parameterFields.js'

// API 独立分类，沿用原持久化键；新增字段未分组时也提供入口，避免静默遗漏。
export const parameterSections = [
  ['弹幕设置', '基础设置', 'switch antiOverlap filterLevel heightPercent fontSizeRate fontOpacity speed timelineOffset'],
  ['弹幕设置', '弹幕字体样式', 'fontWeight fontStyle fontFamily'],
  ['弹幕设置', '弹幕列表', 'danmuList'],
  ['高级设置', '弹幕屏蔽', 'typeFilter sourceFilter showSource'],
  ['高级设置', '弹幕高级屏蔽', 'autoFilterCount mergeSimilarEnable mergeSimilarPercent mergeSimilarTime filterKeywordsEnable filterKeywords'],
  ['高级设置', '弹幕位置转换', 'convertTopTo convertBottomTo'],
  ['高级设置', '额外设置', 'chConvert engine'],
  // 自动匹配沿用播放器高级设置中的分类。
  ['高级设置', '自动匹配', 'autoLoadSwitch matchApiEnable matchMode appendSeasonEpisode cacheDanmakuToServer'],
  ['高级设置', '集数偏移', 'episodeOffsetRules'],
  ['高级设置', '播放界面设置', 'osdTitleEnable osdHeaderClockEnable osdLineChartEnable osdLineChartSkipFilter osdLineChartTime'],
  ['高级设置', '播放设置', 'timeoutCallbackUnit timeoutCallbackValue'],
  ['高级设置', 'Bangumi 设置', 'bgmSearchFallbackEnable bangumiEnable bangumiToken bangumiPostPercent bangumiApiPrefix bangumiImageDomain'],
  ['高级设置', 'TMDB 集数映射设置', 'tmdbEpisodeMappingEnable tmdbApiKey tmdbApiBaseUrl'],
  ['高级设置', '配置持久化', 'configPersistenceEnable configPersistenceAutoSync configPersistenceNamespace'],
  ['高级设置', '媒体库排除设置', 'excludedLibraries'],
  ['高级设置', '搜索内容黑名单', 'animeTitleBlacklist episodeTitleBlacklist blacklistApplyToCustomApi'],
  // API 控制栏与源列表共用原版布局。
  ['弹幕 API', 'API选择、自定义API配置', 'useOfficialApi useCustomApi apiPriority customApiList'],
  ['高级设置', '自定义接口地址', 'customApiPrefix customeCorsProxyUrl customeGetCommentUrl customeGetExtcommentUrl customePosterImgUrl customeDanmakuUrl'],
  ['高级设置', '日志与调试', parameterFields.filter(f => /^(debug|quickDebug|consoleLog|logLevel)/.test(f.key)).map(f => f.key).join(' ')],
]
const groupedKeys = new Set(parameterSections.flatMap(([, , keys]) => keys.split(' ')))
const ungrouped = parameterFields.filter(field => !groupedKeys.has(field.key))
if (ungrouped.length) parameterSections.push(['高级设置', '其他参数', ungrouped.map(field => field.key).join(' ')])

export const parameterChoices = { timeoutCallbackUnit: [[0, '秒'], [1, '分'], [2, '时']], matchMode: [['hashAndFileName', '哈希+文件名'], ['fileNameOnly', '仅文件名']], danmuList: [[0, '不展示'], [1, '屏中'], [2, '所有']], logLevel: [['2', 'WARN'], ['3', 'INFO'], ['4', 'DEBUG']] }
