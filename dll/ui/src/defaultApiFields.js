// 默认配置与完整参数编辑共用字段定义，避免持久化键和内置值漂移。
import { parameterFields } from './parameterFields.js'
import { parameterSections } from './parameterSections.js'
// API 默认视图使用共同分类，避免自动匹配和高级接口设置重复出现。
export const apiGroups = parameterSections.filter(([tab]) => tab === '弹幕 API').map(([tab, title, keys]) => ({ title, tab, fields: keys.split(' ').map(key => {
  const field = parameterFields.find(item => item.key === key)
  // 列表在默认接口中使用 JSON 字符串，以兼容宿主 XML 存储并保留源扩展属性。
  return [key, field.label.replace(/（JSON.*?）/, ''), field.type === 'json' ? JSON.stringify(field.value) : field.value, field.min, field.max, field.step]
}) }))
