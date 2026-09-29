<script setup>
import { computed, ref } from 'vue'
import { parameterFields } from './parameterFields.js'
import { choices } from './defaultFields.js'
import SavedSecretInput from './SavedSecretInput.vue'
import PlayerApiSettings from './PlayerApiSettings.vue'
import PlayerListEditor from './PlayerListEditor.vue'
// 编辑器仅发出草稿修改，保存、敏感清除和用户权限仍由文件管理页负责。
const props = defineProps({ values: Object, enabled: Object, clear: Object, rows: Array, namespace: String, userId: String, search: String, busy: Boolean })
const emit = defineEmits(['value', 'enabled', 'clear'])
const tab = ref('弹幕设置')
// API 独立分类，沿用原持久化键；新增字段未分组时也提供入口，避免静默遗漏。
const sections = [
  ['弹幕设置', '基础设置', 'switch antiOverlap filterLevel heightPercent fontSizeRate fontOpacity speed timelineOffset'],
  ['弹幕设置', '弹幕字体样式', 'fontWeight fontStyle fontFamily'],
  ['弹幕设置', '弹幕列表', 'danmuList'],
  ['高级设置', '弹幕屏蔽', 'typeFilter sourceFilter showSource'],
  ['高级设置', '弹幕高级屏蔽', 'autoFilterCount mergeSimilarEnable mergeSimilarPercent mergeSimilarTime filterKeywordsEnable filterKeywords'],
  ['高级设置', '弹幕位置转换', 'convertTopTo convertBottomTo'],
  ['高级设置', '额外设置', 'chConvert engine'],
  ['弹幕 API', '自动匹配', 'autoLoadSwitch matchApiEnable matchMode appendSeasonEpisode'],
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
  ['弹幕 API', '代理与接口模板', 'customApiPrefix customeCorsProxyUrl customeGetCommentUrl customeGetExtcommentUrl customePosterImgUrl customeDanmakuUrl'],
  ['高级设置', '日志与调试', parameterFields.filter(f => /^(debug|quickDebug|consoleLog|logLevel)/.test(f.key)).map(f => f.key).join(' ')],
]
const groupedKeys = new Set(sections.flatMap(([, , keys]) => keys.split(' ')))
const ungrouped = parameterFields.filter(field => !groupedKeys.has(field.key))
if (ungrouped.length) sections.push(['高级设置', '其他参数', ungrouped.map(field => field.key).join(' ')])
const groups = computed(() => sections.filter(([page]) => props.search || page === tab.value).map(([, title, keys]) => ({ title, fields: keys.split(' ').map(key => parameterFields.find(f => f.key === key)).filter(f => f && (!props.search || `${f.label} ${f.id}`.toLowerCase().includes(props.search.toLowerCase()))) })).filter(g => g.fields.length))
const extraChoices = { matchMode: [['hashAndFileName', '哈希+文件名'], ['fileNameOnly', '仅文件名']], danmuList: [[0, '不展示'], [1, '屏中'], [2, '所有']], logLevel: [['2', 'WARN'], ['3', 'INFO'], ['4', 'DEBUG']] }
function options(field) { return choices[field.key] || extraChoices[field.key] || [] }
function arrayValue(field) {
  try { const value = JSON.parse(props.values[field.id]); return Array.isArray(value) ? value : [] } catch { return [] }
}
function check(field, id, checked) {
  const value = arrayValue(field)
  emit('value', field.id, JSON.stringify(checked ? [...value, id] : value.filter(v => v !== id)))
}
function allOptions(field) {
  const list = options(field)
  return [...list, ...arrayValue(field).filter(id => !list.some(([key]) => key === id)).map(id => [id, id])]
}
function disabled(field) { return props.busy || !props.enabled[field.id] }
function preview(key) { const field = parameterFields.find(f => f.key === key); return props.values[field.id] ?? field.value }
</script>

<template>
  <div class="ede-editor">
    <div class="tabs" role="tablist" aria-label="播放器参数分类">
      <button v-for="name in ['弹幕设置', '弹幕 API', '高级设置']" :key="name" type="button" role="tab" :aria-selected="tab === name" @click="tab = name">{{ name }}</button>
    </div>
    <component :is="group.title === '基础设置' ? 'section' : 'details'" v-for="group in groups" :key="group.title" :open="!!search || group.title === '弹幕屏蔽'">
      <summary v-if="group.title !== '基础设置'">{{ group.title }}</summary>
      <div class="content" :class="{ basic: group.title === '基础设置' }">
        <PlayerApiSettings v-if="group.title === 'API选择、自定义API配置'" :key="`${userId}:${namespace}`" :official="preview('useOfficialApi')" :custom="preview('useCustomApi')" :priority="preview('apiPriority')" :sources="values.danmakuCustomApiList || undefined" :saved="rows.find(r => r.namespace === namespace && r.key === 'danmakuCustomApiList')?.value || '[]'" :disabled="busy" @change="(key, value) => emit('value', parameterFields.find(f => f.key === key).id, value)">
          <template #sources-footer><el-popconfirm title="确认清除自定义源及其凭据？" @confirm="emit('clear', 'danmakuCustomApiList')"><template #reference><button type="button" :disabled="busy || !preview('useCustomApi')">清除已保存内容</button></template></el-popconfirm></template>
        </PlayerApiSettings>
        <div v-for="field in group.title === 'API选择、自定义API配置' ? [] : group.fields" :key="field.id" class="parameter" :title="field.id">
          <div class="row" :class="{ stacked: field.type === 'json' || field.sensitive }">
            <label v-if="field.type !== 'boolean'" :for="`param-${field.key}`">{{ field.label.replace(/（JSON.*?）/, '') }}</label>
            <template v-if="field.sensitive">
              <SavedSecretInput :key="`${userId}:${namespace}:${field.id}`" commit-on-change :model-value="values[field.id]" :value="rows.find(r => r.namespace === namespace && r.key === field.id)?.value || ''" :disabled="busy" @update:model-value="v => emit('value', field.id, v)" />
              <!-- 清除独立确认，不把空白替换框误认为删除。 -->
              <el-popconfirm title="确认清除此项已保存内容？" @confirm="emit('clear', field.id)"><template #reference><button type="button" class="clear-secret" :disabled="busy">清除已保存内容</button></template></el-popconfirm>
            </template>
            <label v-else-if="field.type === 'boolean'" class="check"><input :id="`param-${field.key}`" type="checkbox" :checked="values[field.id]" :disabled="busy" @change="emit('value', field.id, $event.target.checked)">{{ field.label }}</label>
            <PlayerListEditor v-else-if="['excludedLibraries', 'apiPriority'].includes(field.key)" :key="`${userId}:${namespace}:${field.id}`" :kind="field.key" :model-value="values[field.id]" :disabled="busy" @update:model-value="v => emit('value', field.id, v)" />
            <div v-else-if="field.type === 'json' && options(field).length" class="checks">
              <label v-for="[id, title] in allOptions(field)" :key="id"><input type="checkbox" :checked="arrayValue(field).includes(id)" :disabled="busy" @change="check(field, id, $event.target.checked)">{{ title }}</label>
            </div>
            <div v-else-if="['timelineOffset', 'timeoutCallbackValue'].includes(field.key)" class="segments">
              <button v-for="delta in [-30, -10, -5, -1, 0, 1, 5, 10, 30]" :key="delta" type="button" :disabled="busy" @click="emit('value', field.id, delta === 0 ? 0 : field.key === 'timeoutCallbackValue' ? Math.max(0, values[field.id] + delta) : values[field.id] + delta)">{{ delta > 0 ? '+' : '' }}{{ delta }}</button><output>{{ values[field.id] }}</output>
            </div>
            <div v-else-if="field.key === 'timeoutCallbackUnit'" class="segments">
              <button v-for="(unit, index) in ['秒', '分', '时']" :key="unit" type="button" :aria-pressed="values[field.id] === index" :disabled="busy" @click="emit('value', field.id, index)">{{ unit }}</button>
            </div>
            <!-- 滑块使用 change，拖动期间不产生网络请求；原版离散数值仍以滑块展示。 -->
            <template v-else-if="field.type === 'number' && field.min != null && field.max != null && field.key !== 'chConvert'">
              <input :id="`param-${field.key}`" type="range" :min="field.min" :max="field.max" :value="values[field.id]" :disabled="busy" @change="emit('value', field.id, Number($event.target.value))">
              <output>{{ options(field).find(([id]) => id === values[field.id])?.[1] ?? values[field.id] }}</output>
            </template>
            <div v-else-if="options(field).length" class="segments"><button v-for="[id, title] in options(field)" :key="id" type="button" :aria-pressed="values[field.id] === id" :disabled="busy" @click="emit('value', field.id, id)">{{ title }}</button></div>
            <input v-else-if="field.type === 'number'" :id="`param-${field.key}`" type="number" :value="values[field.id]" :disabled="busy" @change="emit('value', field.id, $event.target.value === '' ? NaN : Number($event.target.value))">
            <textarea v-else-if="field.type === 'json' || field.key === 'filterKeywords'" :id="`param-${field.key}`" :value="values[field.id]" rows="5" :disabled="busy" @change="emit('value', field.id, $event.target.value)" />
            <input v-else :id="`param-${field.key}`" type="text" :value="values[field.id]" :disabled="busy" @change="emit('value', field.id, $event.target.value)" @keydown.enter="$event.target.blur()">
          </div>
        </div>
        <div v-if="group.title === '弹幕字体样式'" class="preview"><span :style="{ fontFamily: preview('fontFamily'), fontWeight: preview('fontWeight'), fontSize: `${preview('fontSizeRate') / 100}em`, opacity: preview('fontOpacity') / 100, fontStyle: preview('fontStyle') === 1 ? 'italic' : 'normal', transform: preview('fontStyle') === 2 ? 'skewX(-10deg)' : 'none' }">简中/繁體/English/こんにちはウォルド/<br>ABC/abc/012/~!@&lt;?&gt;[]/《？》【】<br>☆*: .｡. o(≧▽≦)o .｡.:*☆<br>emoji:😆👏🎈🍋🌞⁉️🎉</span></div>
      </div>
    </component>
  </div>
</template>

<style scoped>
.ede-editor { max-width: 760px; margin: auto; color: var(--el-text-color-primary); }
.tabs { display: flex; justify-content: center; border-bottom: 1px solid var(--el-border-color); margin-bottom: 16px; }
.tabs button, .segments button { border: 0; border-bottom: 2px solid transparent; background: transparent; color: inherit; padding: 10px 16px; cursor: pointer; }
.tabs [aria-selected=true], .segments [aria-pressed=true] { color: var(--el-color-primary); border-color: var(--el-color-primary); }
summary { cursor: pointer; padding: 14px 4px; font-weight: 600; }
details { border-bottom: 1px solid var(--el-border-color); }
.content { padding: 6px 12px 14px; }
.parameter { padding: 7px 0; min-width: 0; }
.row { display: flex; align-items: center; gap: 12px; min-height: 30px; }
.row > label:first-child { flex: 0 0 10em; font-size: 14px; }
.row input[type=range] { flex: 1; min-width: 0; }
output { min-width: 4em; text-align: right; }
input { accent-color: var(--el-color-primary); }
input[type=checkbox] { width: 16px; height: 16px; }
.stacked { flex-wrap: wrap; }.stacked > label:first-child { flex-basis: 100%; }
.checks, .segments { display: flex; flex-wrap: wrap; gap: 8px 12px; }
.checks label { display: inline-flex; align-items: center; gap: 5px; }
input[type=text], input[type=number], textarea { box-sizing: border-box; flex: 1; width: 100%; min-width: 0; padding: 8px; border: 1px solid var(--el-border-color); border-radius: 4px; background: var(--el-bg-color); color: inherit; font: inherit; }
textarea { resize: vertical; }.hint { color: var(--el-text-color-secondary); font-size: 12px; }.save-item { display: flex; align-items: center; gap: 4px; margin-top: 3px; }.save-item input { width: 12px; height: 12px; }
.basic { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }.basic > :nth-child(n+3) { grid-column: 1 / -1; }.basic .row > label:first-child { flex-basis: 6em; }
.preview { padding: 12px; background: #6a96bd; border: 1px solid gray; border-radius: 4px; text-align: center; color: black; overflow-wrap: anywhere; }.preview span { display: inline-block; max-width: 100%; }
:disabled { opacity: .55; cursor: not-allowed; }button:focus-visible, input:focus-visible, summary:focus-visible, textarea:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
@media(max-width: 560px) { .content { padding-inline: 0; }.row { flex-wrap: wrap; }.row > label:first-child { flex-basis: 100%; }.basic .row { flex-wrap: nowrap; }.basic .row > label:first-child { flex-basis: 5em; } }
</style>
