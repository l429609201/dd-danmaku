<script setup>
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { api } from './api.js'

const props = defineProps({
  userId: { type: String, default: '' },
  active: { type: Boolean, default: true },
  refreshToken: { type: Number, default: 0 },
  globalScope: { type: Boolean, default: false },
})
const health = ref(null), busy = ref(false), error = ref(''), exhausted = ref(false)
const alive = ref(false), visible = ref(!document.hidden)
const available = computed(() => alive.value && props.active && visible.value)
const providers = [['tmdb', 'TMDB'], ['bangumi', 'Bangumi']]
const statuses = { disabled: '未启用', checking: '验证中', valid: '有效', invalid: '无效' }
// 仅翻译固定原因码，未知响应不原样显示，避免上游地址或凭据进入界面。
const reasons = {
  not_configured: '未配置所需凭据', configuration_invalid: '配置格式无效',
  credential_rejected: '凭据被拒绝，请检查权限或有效期', upstream_timeout: '服务验证超时',
  upstream_failed: '服务暂不可用或连接失败', invalid_upstream_json: '服务返回的数据格式无效',
  invalid_upstream_data: '服务返回的数据不完整', source_not_allowed: '来源未获准访问',
}
let timer, controller, generation = 0, attempts = 0
function stop() {
  ++generation; clearTimeout(timer); controller?.abort(); controller = null; busy.value = false
}
function checkedAt(value) {
  if (!value) return '尚未完成验证'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '更新时间未知' : date.toLocaleString('zh-CN')
}
async function load(force = false) {
  if (!available.value || busy.value) return
  const version = generation, userId = props.userId
  controller = new AbortController(); busy.value = true; error.value = ''
  try {
    const data = await (force ? api.recheckMetadataHealth(userId, controller.signal) : api.metadataHealth(userId, controller.signal))
    if (version !== generation) return
    health.value = data
    if (providers.some(([key]) => data?.[key]?.status === 'checking')) {
      // 每轮最多轮询30次；切页、后台、卸载和切换用户均取消请求及定时器。
      if (++attempts < 30) timer = setTimeout(() => { void load() }, 2000)
      else exhausted.value = true
    }
  } catch (e) {
    if (version === generation && e.name !== 'AbortError') error.value = '状态读取失败，请稍后重新读取。'
  } finally { if (version === generation) busy.value = false }
}
function restart(force = false) {
  stop(); attempts = 0; exhausted.value = false; error.value = ''
  if (available.value) void load(force)
}
function activate() { if (!alive.value) alive.value = true }
function visibilityChanged() { visible.value = !document.hidden }
watch([available, () => props.userId, () => props.refreshToken], () => { health.value = null; restart() })
onMounted(() => { document.addEventListener('visibilitychange', visibilityChanged); activate() })
onActivated(activate)
onDeactivated(() => { alive.value = false; stop() })
onBeforeUnmount(() => { alive.value = false; stop(); document.removeEventListener('visibilitychange', visibilityChanged) })
</script>

<template>
  <section class="metadata-status" aria-label="元数据服务验证状态">
    <div class="status-head"><strong>元数据服务状态</strong><div><el-button size="small" :disabled="!available || busy" @click="restart()">读取状态</el-button><el-button size="small" :loading="busy" :disabled="!available || busy" @click="restart(true)">重新验证</el-button></div></div>
    <p>{{ globalScope ? '全局默认没有独立健康状态：以下为当前登录用户的实际生效配置（包含本人覆盖），不是全局配置验证结果。' : '以下为所选用户实际生效的已保存配置，包含主动参数与默认值继承，不验证未保存草稿。' }}</p>
    <p>配置保存后由服务器异步自检；失败会保留配置，但不会向 AI 提供该服务的元数据证据。</p>
    <div v-if="health" class="provider-list" role="status" aria-live="polite">
      <div v-for="[key, name] in providers" :key="key" class="provider">
        <strong>{{ name }}</strong>
        <el-tag :type="health[key]?.status === 'valid' ? 'success' : health[key]?.status === 'invalid' ? 'danger' : 'info'">{{ statuses[health[key]?.status] || '状态未知' }}</el-tag>
        <span>更新时间：{{ checkedAt(health[key]?.checkedAt) }}</span>
        <span v-if="health[key]?.reason">{{ reasons[health[key].reason] || '验证未通过，请检查配置或稍后重试' }}</span>
      </div>
    </div>
    <p v-else-if="busy" role="status">正在读取状态…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="exhausted">自动刷新已暂停，验证可能仍在后台进行，请稍后读取状态。</p>
  </section>
</template>

<style scoped>
.metadata-status { margin: 16px 0; padding: 14px; border: 1px solid var(--el-border-color); border-radius: 6px; }
.status-head, .provider { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.status-head { justify-content: space-between; }
.provider-list { display: grid; gap: 12px; }
p, .provider span { font-size: 13px; color: var(--el-text-color-secondary); line-height: 1.6; }
</style>
