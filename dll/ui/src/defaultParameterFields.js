import { parameterFields } from './parameterFields.js'
import { parameterSections } from './parameterSections.js'

// 已有筛选字段保持数组协议；其他列表以 JSON 文本保存，兼容宿主 XML。
export const nativeDefaultArrays = new Set(['typeFilter', 'sourceFilter', 'showSource'])
export const defaultParameterGroups = parameterSections.map(([tab, title, keys]) => ({
  tab, title, basic: title === '基础设置',
  fields: keys.split(' ').map(key => {
    const field = parameterFields.find(item => item.key === key)
    const value = field.type === 'json' && !nativeDefaultArrays.has(key) ? JSON.stringify(field.value) : field.value
    return [key, field.label.replace(/（JSON.*?）/, ''), value, field.min, field.max]
  }),
}))
export const defaultParameterFields = defaultParameterGroups.flatMap(group => group.fields)
