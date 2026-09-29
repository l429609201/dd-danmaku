// 默认配置与完整参数编辑共用字段定义，避免持久化键和内置值漂移。
import { parameterFields } from './parameterFields.js'
const definitions = [
  ['自动匹配', 'autoLoadSwitch matchApiEnable matchMode appendSeasonEpisode'],
  // 控制栏和源列表保持原版同一区域，旧单地址仅保留高级兼容入口。
  ['API选择、自定义API配置', 'useOfficialApi useCustomApi apiPriority customApiList'],
  ['代理与接口模板', 'customApiPrefix customeCorsProxyUrl customeGetCommentUrl customeGetExtcommentUrl customePosterImgUrl customeDanmakuUrl'],
]
export const apiGroups = definitions.map(([title, keys]) => ({ title, tab: '弹幕 API', fields: keys.split(' ').map(key => {
  const field = parameterFields.find(item => item.key === key)
  // 列表在默认接口中使用 JSON 字符串，以兼容宿主 XML 存储并保留源扩展属性。
  return [key, field.label.replace(/（JSON.*?）/, ''), field.type === 'json' ? JSON.stringify(field.value) : field.value]
}) }))
