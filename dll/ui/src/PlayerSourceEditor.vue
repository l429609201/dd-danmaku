<script setup>
import { computed, inject, ref, onBeforeUnmount } from 'vue'
import { useUiRef } from './useUiState.js'
import PlayerSourceForm from './PlayerSourceForm.vue'
import { api } from './api.js'
const props = defineProps({ modelValue: String, saved: String, disabled: Boolean })
const emit = defineEmits(['update:modelValue'])
const scope = inject('parameterDraftScope', ref('unscoped'))
const editing = useUiRef(`sources-editing:${scope.value}`, -1, value => Number.isInteger(value) && value >= -1 && value < 100)
const addingKey = ref(0), detecting = ref(false), error = ref(''), addingForm = ref(null), editingForms = ref([])
let active = true
onBeforeUnmount(() => { active = false })
// 保留扩展属性；只有确认保存才提交草稿，检测失败不阻止添加。
const parsed = computed(() => {
  try {
    const list = JSON.parse(props.modelValue ?? props.saved ?? '[]')
    if (!Array.isArray(list) || list.some(v => typeof v !== 'string' && (!v || typeof v !== 'object' || Array.isArray(v)))) return null
    return list.map((v, i) => typeof v === 'string' ? { name: `自定义源${i + 1}`, url: v, enabled: true } : { ...v })
  } catch { return null }
})
const locked = computed(() => props.disabled || detecting.value)
function publish(list) { emit('update:modelValue', JSON.stringify(list)) }
function origin(url) { if (url === 'emby-proxy://custom') return '实例共享来源（Emby 中转）'; try { return new URL(url).origin } catch { return '地址格式无效' } }
async function addProxy(name) {
  if (locked.value || editing.value >= 0 || !parsed.value) return
  error.value = ''
  if (parsed.value.some(item => item.type === 'emby-proxy' || item.url === 'emby-proxy://custom')) {
    error.value = '已引用实例共享来源（Emby 中转）'; return
  }
  detecting.value = true
  const original = JSON.stringify(parsed.value)
  try {
    const data = await api.validateProxy()
    if (!active) return
    if ((data?.available ?? data?.Available) !== true) throw new Error('后台上游验证失败')
    if (JSON.stringify(parsed.value) !== original || props.disabled) throw new Error('配置已变化，请重新添加')
    publish([...parsed.value, { name: name || 'Emby 插件代理', type: 'emby-proxy',
      url: 'emby-proxy://custom', enabled: true, appId: '', appSecret: '',
      serverName: data.serverType ?? data.ServerType ?? 'generic' }])
    addingForm.value?.discardDraft()
    addingKey.value++
  } catch (e) { if (active) error.value = e.message || '实例共享来源验证失败' }
  finally { detecting.value = false }
}
async function submit(value, index = -1) {
  if (locked.value) return
  if (parsed.value.some((item, i) => i !== index && item.url.replace(/\/+$/, '') === value.url)) { error.value = '此 API 地址已存在'; return }
  error.value = ''; detecting.value = true
  const previous = parsed.value[index]
  if (!previous || previous.url !== value.url || !previous.serverName) {
    value.serverName = ''; value.serverVersion = ''
    for (const path of ['/api/v2/version', '/version']) {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000)
      try {
        const response = await fetch(value.url + path, { headers: { Accept: 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal })
        const data = response.ok ? await response.json() : null
        if (typeof data?.serverName === 'string') { value.serverName = data.serverName; value.serverVersion = String(data.version || ''); break }
      } catch { /* 与播放器一致，网络检测失败仍允许保存。 */ }
      finally { clearTimeout(timer) }
    }
  }
  detecting.value = false
  if (!active) return
  const list = [...parsed.value]
  if (index < 0) { addingForm.value?.discardDraft(); list.push(value); addingKey.value++ }
  else { editingForms.value[index]?.discardDraft(); list[index] = value }
  editing.value = -1; publish(list)
}
function move(index, offset) {
  const list = [...parsed.value], target = index + offset
  if (locked.value || target < 0 || target >= list.length) return
  const [source] = list.splice(index, 1); list.splice(target, 0, source); publish(list)
}
function remove(index) {
  if (!locked.value && window.confirm('确认移除此弹幕源及其凭据？')) publish(parsed.value.filter((_, i) => i !== index))
}
</script>
<template>
  <div class="sources">
    <p v-if="parsed === null" role="alert">源列表格式无效，已保留原值；请先通过原始参数管理修复。</p>
    <template v-else>
      <PlayerSourceForm ref="addingForm" :key="addingKey" :disabled="locked || editing >= 0" @submit="value => submit(value)" @proxy="addProxy" />
      <p v-if="error" role="alert">{{ error }}</p>
      <div class="source-list">
        <p v-if="!parsed.length">暂无自定义源，请在上方添加</p>
        <div v-for="(source, index) in parsed" :key="index" class="source">
          <PlayerSourceForm v-if="editing === index" :ref="form => { editingForms[index] = form }" :draft-id="`edit-${index}`" editing :source="source" :disabled="locked" @submit="value => submit(value, index)" @cancel="editingForms[index]?.discardDraft(); editing = -1" />
          <template v-else>
            <input type="checkbox" :aria-label="`启用 ${source.name}`" :checked="source.enabled !== false" :disabled="locked || editing >= 0" @change="publish(parsed.map((item, i) => i === index ? { ...item, enabled: $event.target.checked } : item))">
            <div class="info" :class="{ muted: source.enabled === false }"><strong>{{ source.name || `自定义源${index + 1}` }}</strong><span v-if="source.appId && source.appSecret" title="已配置 AppId/AppSecret"> 🔒</span><span v-if="source.serverName === 'Misaka_Danmu_Server'" class="badge">御坂弹幕库 {{ source.serverVersion ? `v${source.serverVersion}` : '' }}</span><small>{{ origin(source.url) }}</small></div>
            <div class="buttons"><button v-if="source.type !== 'emby-proxy'" type="button" :disabled="locked || editing >= 0" @click="editing = index">编辑</button><span v-else title="上游地址和凭据由管理员在实例共享来源（Emby 中转）中配置">实例共享</span><button type="button" aria-label="上移" :disabled="locked || editing >= 0 || index === 0" @click="move(index, -1)">↑</button><button type="button" aria-label="下移" :disabled="locked || editing >= 0 || index === parsed.length - 1" @click="move(index, 1)">↓</button><button type="button" :disabled="locked || editing >= 0" @click="remove(index)">删除</button></div>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>
<style scoped>
/* 摘要列表默认不展示凭据和完整 URL，保持原版紧凑卡片布局。 */
.sources { width: 100%; }.source-list { max-height: 250px; overflow: auto; border: 1px solid var(--el-border-color); border-radius: 4px; padding: .5em; margin-top: 1em; }.source { display: flex; align-items: center; gap: .5em; background: rgba(0,0,0,.1); padding: .5em; margin-bottom: .5em; border-radius: 4px; }.source > .source-form { flex: 1; min-width: 0; }.info { flex: 1; min-width: 0; overflow-wrap: anywhere; }.info small { display: block; font-size: .8em; opacity: .7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.muted { opacity: .55; }.badge { display: inline-block; padding: .08em .45em; background: #7b5ea7; color: white; border-radius: 3px; font-size: .72em; }.buttons { display: flex; flex-wrap: wrap; gap: .2em; }button { padding: .3em; border: 0; border-radius: 4px; background: transparent; color: inherit; cursor: pointer; }input { accent-color: #52b54b; }:disabled { opacity: .55; cursor: not-allowed; }:focus-visible { outline: 2px solid var(--el-color-primary); }@media(max-width: 540px) { .buttons { max-width: 5em; } }
</style>
