<script setup>
import { computed, provide, onMounted, onBeforeUnmount, ref } from 'vue'
import { useUiRef, useDetailsState, useSafeDrafts } from './useUiState.js'
import { api } from './api.js'

const users = ref([]), loadedId = ref('')
const selected = useUiRef('defaults-user', '', value => typeof value === 'string')
provide('parameterDraftScope', computed(() => `defaults:${selected.value || 'global'}`))
const values = ref(null), global = ref({}), busy = ref(false), saving = ref(false)
const error = ref(''), message = ref(''), restoredDrafts = ref(false)
const tab = useUiRef('defaults-tab', '弹幕设置', value => ['弹幕设置', '弹幕 API', '高级设置'].includes(value))
const details = useDetailsState('defaults-details')
let controller, generation = 0
import { choices } from './defaultFields.js'
import { parameterChoices } from './parameterSections.js'
import { defaultParameterGroups as allGroups, defaultParameterFields as allFields, nativeDefaultArrays } from './defaultParameterFields.js'
import { parameterFields, serializeParameter } from './parameterFields.js'
import DefaultParameterControl from './DefaultParameterControl.vue'
import PlayerApiSettings from './PlayerApiSettings.vue'
const drafts = useSafeDrafts('frontend-defaults', key => parameterFields.some(field => field.key === key && !field.sensitive))
function stageInput(event) {
  const field = parameterFields.find(item => `default-${item.key}` === event.target.id)
  if (!field || !values.value || busy.value || saving.value) return
  const value = field.type === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value
  values.value[field.key] = value
  drafts.stage(field.key, value)
}
function discardRestored() {
  drafts.discard(); void load()
}
function pageFor(group) { return group.tab }
function setApiValue(field, value) {
  values.value[field[0]] = value
  drafts.stage(field[0], value)
  try {
    const definition = parameterFields.find(item => item.key === field[0])
    serializeParameter(definition, nativeDefaultArrays.has(field[0]) ? JSON.stringify(value) : value)
    void save()
  } catch (e) { error.value = e.message }
}

function optionsFor(field) {
  const options = choices[field[0]] || parameterChoices[field[0]] || []
  const extra = Array.isArray(effective(field)) ? effective(field).filter(v => !options.some(([id]) => id === v)).map(v => [v, v]) : []
  return [...options, ...extra]
}
function effective(field) {
  return values.value?.[field[0]] ?? (selected.value ? global.value[field[0]] : null) ?? field[2]
}
function toggle(field, checked) {
  values.value[field[0]] = checked ? effective(field) : null
  drafts.stage(field[0], values.value[field[0]])
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
    drafts.select(id || 'global')
    restoredDrafts.value = drafts.count.value > 0
    for (const [key, value] of Object.entries(drafts.entries.value)) {
      if (allFields.some(field => field[0] === key)) values.value[key] = value
    }
  } catch (e) { if (version === generation && e.name !== 'AbortError') error.value = e.message }
  finally { if (version === generation) busy.value = false }
}
async function loadUsers() {
  try { users.value = await api.users() }
  catch (e) { error.value = `用户列表读取失败：${e.message}` }
}
async function save(reset = false, explicit = false) {
  if (restoredDrafts.value && !explicit && !reset) return
  if (!values.value || saving.value || loadedId.value !== selected.value) return
  saving.value = true; error.value = ''; message.value = ''
  try {
    // 所有空值显式发送 null，表示继承；不能将默认预览写成用户专属值。
    const data = Object.fromEntries(allFields.map(([key]) => [key, values.value[key] ?? null]))
    if (!reset) {
      for (const [key, value] of Object.entries(data)) {
        if (value != null) serializeParameter(parameterFields.find(field => field.key === key), nativeDefaultArrays.has(key) ? JSON.stringify(value) : value)
      }
    }
    if (reset) {
      await api.resetFrontendDefaults(selected.value)
      values.value = Object.fromEntries(allFields.map(([key]) => [key, null]))
    } else await api.saveFrontendDefaults(selected.value, data)
    if (reset) drafts.discard()
    else for (const [key, value] of Object.entries(data)) drafts.acknowledge(key, value)
    restoredDrafts.value = false
    // 保存成功不重新挂载控件，保留展开状态和焦点。
    message.value = reset ? '已恢复继承全局' : '已自动保存'
  } catch (e) { error.value = `${e.message}；若连接中断，请重新读取确认服务器状态` }
  finally { saving.value = false }
}
onMounted(async () => {
  await loadUsers()
  if (selected.value && !users.value.some(user => user.id === selected.value)) selected.value = ''
  await load()
})
onBeforeUnmount(() => { ++generation; controller?.abort() })
</script>

<template>
  <el-card shadow="never" v-loading="busy" class="ede-surface">
    <template #header><strong>播放器默认参数</strong></template>
    <el-alert title="优先级：用户主动设置 > 用户专属默认 > 全局默认 > 脚本内置。编辑后自动保存，继承值不会因打开页面而写入。" type="info" :closable="false" />
    <el-alert v-if="tab !== '弹幕设置'" title="全局默认中的源凭据、令牌和 API Key 会共享给继承此配置的用户；个人凭据请设为对应用户的专属默认。" type="warning" :closable="false" />
    <div class="scope-bar">
      <el-select v-model="selected" aria-label="配置范围" :disabled="saving || busy || !!error" @change="load">
        <el-option label="全局默认" value="" /><el-option v-for="user in users" :key="user.id" :label="user.name" :value="user.id" />
      </el-select>
      <el-button :disabled="saving || busy" @click="load">重新读取</el-button>
      <el-button :disabled="saving" @click="loadUsers">刷新用户列表</el-button>
    </div>
    <div class="save-status" role="status" aria-live="polite">{{ error || (saving ? '正在保存…' : message || '修改后自动保存') }}<el-button v-if="error && values" link :disabled="saving" @click="save(false, true)">重试保存</el-button></div>
    <!-- 默认配置接口为整份覆盖，保存期间禁用编辑确保快照顺序。 -->
    <div v-if="drafts.count.value" class="save-status" role="status">已保留 {{ drafts.count.value }} 项未保存草稿 <el-button link :disabled="saving || busy" @click="save(false, true)">保存草稿</el-button><el-button link :disabled="saving || busy" @click="discardRestored">丢弃草稿</el-button></div>
    <fieldset v-if="values" :key="selected" class="player-settings" :disabled="saving || busy" @input="stageInput">
      <div class="tabs" role="tablist"><button v-for="name in ['弹幕设置', '弹幕 API', '高级设置']" :key="name" type="button" role="tab" :aria-selected="tab === name" @click="tab = name">{{ name }}</button></div>
      <component :is="group.basic ? 'section' : 'details'" v-for="group in allGroups.filter(g => pageFor(g) === tab)" :key="group.title" :open="details.isOpen(`${selected}:${group.title}`, group.title === '弹幕屏蔽')" @toggle="details.toggle(`${selected}:${group.title}`, $event)" :class="{ basic: group.basic }">
        <summary v-if="!group.basic">{{ group.title }}</summary>
        <div class="setting-content" :class="{ 'basic-controls': group.basic }">
          <PlayerApiSettings v-if="group.title === 'API选择、自定义API配置'" :key="selected" :official="effective(allFields.find(f => f[0] === 'useOfficialApi'))" :custom="effective(allFields.find(f => f[0] === 'useCustomApi'))" :priority="effective(allFields.find(f => f[0] === 'apiPriority'))" :sources="effective(allFields.find(f => f[0] === 'customApiList'))" :disabled="saving || busy" @change="(key, value) => setApiValue(allFields.find(f => f[0] === key), value)">
            <template #origins><div class="api-origins"><p v-for="field in group.fields" :key="field[0]">{{ field[1] }} · {{ values[field[0]] != null ? '当前覆盖' : selected && global[field[0]] != null ? '全局继承' : '脚本内置' }} <button v-if="values[field[0]] != null" type="button" @click="toggle(field, false)">恢复继承</button></p></div></template>
          </PlayerApiSettings>
          <template v-for="field in group.title === 'API选择、自定义API配置' ? [] : group.fields" :key="field[0]">
            <DefaultParameterControl :field="field" :value="effective(field)" :options="optionsFor(field)" :custom="values[field[0]] != null"
              :origin="selected && global[field[0]] != null ? '全局继承' : '脚本内置'"
              @custom="checked => toggle(field, checked)" @update="value => setApiValue(field, value)" />
          </template>
          <div v-if="group.title === '弹幕字体样式'" class="font-preview">
            <span :style="{ fontFamily: effective(allFields.find(f => f[0] === 'fontFamily')), fontWeight: effective(allFields.find(f => f[0] === 'fontWeight')), fontStyle: effective(allFields.find(f => f[0] === 'fontStyle')) === 1 ? 'italic' : 'normal', transform: effective(allFields.find(f => f[0] === 'fontStyle')) === 2 ? 'skewX(-10deg)' : 'none', opacity: effective(allFields.find(f => f[0] === 'fontOpacity')) / 100, fontSize: `${effective(allFields.find(f => f[0] === 'fontSizeRate')) / 100}em` }">简中/繁體/English/こんにちはウォルド/<br>ABC/abc/012/~!@&lt;?&gt;[]/《？》【】<br>☆*: .｡. o(≧▽≦)o .｡.:*☆<br>emoji:😆👏🎈🍋🌞⁉️🎉</span>
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
