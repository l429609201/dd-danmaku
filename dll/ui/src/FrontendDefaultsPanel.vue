<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { api } from './api.js'

const users = ref([]), selected = ref(''), loadedId = ref('')
const values = ref(null), global = ref({}), busy = ref(false), saving = ref(false)
const error = ref(''), message = ref(''), tab = ref('弹幕设置')
let controller, generation = 0
import { groups, fields, choices } from './defaultFields.js'
import DefaultParameterControl from './DefaultParameterControl.vue'
// 保留未知的已保存来源，避免界面升级静默丢弃用户配置。
import { apiGroups } from './defaultApiFields.js'
import PlayerApiSettings from './PlayerApiSettings.vue'
// 独立 API 分组避免反向影响完整参数编辑器的字段生成。
const allGroups = [...groups.filter(g => g.title !== '自动匹配'), ...apiGroups]
const allFields = allGroups.flatMap(g => g.fields)
function pageFor(group) { return group.tab || (group.basic || group.title === '弹幕字体样式' ? '弹幕设置' : '高级设置') }
function setApiValue(field, value) { values.value[field[0]] = value; void save() }

function optionsFor(field) {
  const options = choices[field[0]] || []
  const extra = Array.isArray(effective(field)) ? effective(field).filter(v => !options.some(([id]) => id === v)).map(v => [v, v]) : []
  return [...options, ...extra]
}
function displayValue(field) {
  const value = effective(field)
  const label = v => choices[field[0]]?.find(([id]) => id === v)?.[1] ?? String(v)
  return Array.isArray(value) ? (value.map(label).join('、') || '未选择') : typeof value === 'boolean' ? (value ? '开启' : '关闭') : value === '' ? '空' : label(value)
}
function effective(field) {
  return values.value?.[field[0]] ?? (selected.value ? global.value[field[0]] : null) ?? field[2]
}
function toggle(field, checked) {
  values.value[field[0]] = checked ? effective(field) : null
  void save()
}
async function load() {
  controller?.abort(); controller = new AbortController()
  const version = ++generation, id = selected.value
  busy.value = true; error.value = ''; message.value = ''; values.value = null
  try {
    const data = await api.frontendDefaults(id, controller.signal)
    if (version !== generation) return
    global.value = id ? data.global : data
    values.value = { ...(id ? data.user : data) }; loadedId.value = id
  } catch (e) { if (version === generation && e.name !== 'AbortError') error.value = e.message }
  finally { if (version === generation) busy.value = false }
}
async function loadUsers() {
  try { users.value = await api.users() }
  catch (e) { error.value = `用户列表读取失败：${e.message}` }
}
async function save(reset = false) {
  if (!values.value || saving.value || loadedId.value !== selected.value) return
  saving.value = true; error.value = ''; message.value = ''
  try {
    // 所有空值显式发送 null，表示继承；不能将默认预览写成用户专属值。
    const data = Object.fromEntries(allFields.map(([key]) => [key, values.value[key] ?? null]))
    if (reset) {
      await api.resetFrontendDefaults(selected.value)
      values.value = Object.fromEntries(allFields.map(([key]) => [key, null]))
    } else await api.saveFrontendDefaults(selected.value, data)
    // 保存成功不重新挂载控件，保留展开状态和焦点。
    message.value = reset ? '已恢复继承全局' : '已自动保存'
  } catch (e) { error.value = `${e.message}；若连接中断，请重新读取确认服务器状态` }
  finally { saving.value = false }
}
onMounted(() => { load(); loadUsers() })
onBeforeUnmount(() => { ++generation; controller?.abort() })
</script>

<template>
  <el-card shadow="never" v-loading="busy" class="ede-surface">
    <template #header><strong>播放器默认参数</strong></template>
    <el-alert title="优先级：用户主动设置 > 用户专属默认 > 全局默认 > 脚本内置。编辑后自动保存，继承值不会因打开页面而写入。" type="info" :closable="false" />
    <el-alert v-if="tab === '弹幕 API'" title="全局 API 源及其凭据会发送给继承此配置的使用者，用于浏览器直连；用户覆盖仅该用户及管理员可读取。" type="warning" :closable="false" />
    <div class="scope-bar">
      <el-select v-model="selected" aria-label="配置范围" :disabled="saving || busy || !!error" @change="load">
        <el-option label="全局默认" value="" /><el-option v-for="user in users" :key="user.id" :label="user.name" :value="user.id" />
      </el-select>
      <el-button :disabled="saving || busy" @click="load">重新读取</el-button>
      <el-button :disabled="saving" @click="loadUsers">刷新用户列表</el-button>
    </div>
    <div class="save-status" role="status" aria-live="polite">{{ error || (saving ? '正在保存…' : message || '修改后自动保存') }}<el-button v-if="error && values" link :disabled="saving" @click="save()">重试保存</el-button></div>
    <!-- 默认配置接口为整份覆盖，保存期间禁用编辑确保快照顺序。 -->
    <fieldset v-if="values" class="player-settings" :disabled="saving || busy">
      <div class="tabs" role="tablist"><button v-for="name in ['弹幕设置', '弹幕 API', '高级设置']" :key="name" type="button" role="tab" :aria-selected="tab === name" @click="tab = name">{{ name }}</button></div>
      <component :is="group.basic ? 'section' : 'details'" v-for="group in allGroups.filter(g => pageFor(g) === tab)" :key="group.title" :open="group.title === '弹幕屏蔽'" :class="{ basic: group.basic }">
        <summary v-if="!group.basic">{{ group.title }}</summary>
        <div class="setting-content" :class="{ 'basic-controls': group.basic }">
          <PlayerApiSettings v-if="group.title === 'API选择、自定义API配置'" :key="selected" :official="effective(allFields.find(f => f[0] === 'useOfficialApi'))" :custom="effective(allFields.find(f => f[0] === 'useCustomApi'))" :priority="effective(allFields.find(f => f[0] === 'apiPriority'))" :sources="effective(allFields.find(f => f[0] === 'customApiList'))" :disabled="saving || busy" @change="(key, value) => setApiValue(allFields.find(f => f[0] === key), value)">
            <template #origins><div class="api-origins"><p v-for="field in group.fields" :key="field[0]">{{ field[1] }} · {{ values[field[0]] != null ? '当前覆盖' : selected && global[field[0]] != null ? '全局继承' : '脚本内置' }} <button v-if="values[field[0]] != null" type="button" @click="toggle(field, false)">恢复继承</button></p></div></template>
          </PlayerApiSettings>
          <template v-for="field in group.title === 'API选择、自定义API配置' ? [] : group.fields" :key="field[0]">
            <DefaultParameterControl :field="field" :value="effective(field)" :options="field[0] === 'matchMode' ? [['fileNameOnly', '仅文件名'], ['hashAndFileName', '哈希+文件名']] : optionsFor(field)" :custom="values[field[0]] != null"
              :origin="selected && global[field[0]] != null ? '全局继承' : '脚本内置'"
              @custom="checked => toggle(field, checked)" @update="value => setApiValue(field, value)" />
          </template>
          <div v-if="group.title === '弹幕字体样式'" class="font-preview">
            <span :style="{ fontFamily: effective(fields.find(f => f[0] === 'fontFamily')), fontWeight: effective(fields.find(f => f[0] === 'fontWeight')), fontStyle: effective(fields.find(f => f[0] === 'fontStyle')) === 1 ? 'italic' : 'normal', transform: effective(fields.find(f => f[0] === 'fontStyle')) === 2 ? 'skewX(-10deg)' : 'none', opacity: effective(fields.find(f => f[0] === 'fontOpacity')) / 100, fontSize: `${effective(fields.find(f => f[0] === 'fontSizeRate')) / 100}em` }">简中/繁體/English/こんにちはウォルド/<br>ABC/abc/012/~!@&lt;?&gt;[]/《？》【】<br>☆*: .｡. o(≧▽≦)o .｡.:*☆<br>emoji:😆👏🎈🍋🌞⁉️🎉</span>
          </div>
        </div>
      </component>
      <div class="actions"><el-popconfirm v-if="selected" title="清除此用户全部专属默认并恢复继承？" @confirm="save(true)"><template #reference><el-button :disabled="saving || busy">恢复全局继承</el-button></template></el-popconfirm></div>
    </fieldset>
  </el-card>
</template>

<style scoped>
/* 复刻播放器的紧凑单列和折叠分区，不依赖 Emby 自定义元素初始化。 */
.player-settings { max-width: 680px; min-width: 0; margin: 20px auto 0; padding: 0; border: 0; color: var(--el-text-color-primary); }
.player-settings details { border-bottom: 1px solid var(--el-border-color); }
summary { padding: 14px 4px; cursor: pointer; font-size: 15px; font-weight: 600; }
summary:hover { color: var(--el-color-primary); }
summary:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
.setting-content { padding: 0 12px 14px; }
.basic-controls { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; }
.basic-controls > :nth-child(n+3) { grid-column: 1 / -1; }
.font-preview { padding: 18px 10px; margin-top: 12px; border: 1px solid #808080; border-radius: 4px; background: #6a96bd; color: #000; text-align: center; overflow-wrap: anywhere; }
.font-preview span { display: inline-block; max-width: 100%; }
.scope-bar, .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 18px; }
.scope-bar .el-select { width: 260px; max-width: 100%; }
p { color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.7; }
.el-alert { margin: 12px 0; }
@media (max-width: 540px) { .setting-content { padding-inline: 0; } .basic-controls { gap: 0 8px; } }
</style>
