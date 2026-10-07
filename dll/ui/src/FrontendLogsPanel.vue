<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { Bottom, CopyDocument, Delete, Download, Refresh, Search, VideoPause, VideoPlay } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from './api.js'

const props = defineProps({ administrator: Boolean, currentUserId: { type: String, required: true } })
const files = ref([]), users = ref([]), entries = ref([]), total = ref(0)
const fileId = ref('current'), userId = ref(props.currentUserId), level = ref(''), keyword = ref('')
const page = ref(1), pageSize = ref(100), showSession = ref(false)
const loading = ref(false), refreshing = ref(false), exporting = ref(false), clearing = ref(false)
const paused = ref(false), active = ref(true), hidden = ref(typeof document !== 'undefined' && document.hidden)
const error = ref(''), usersError = ref(''), exportError = ref(''), clearError = ref(''), clearMessage = ref('')
const status = ref('loading'), logViewport = ref(null)
const maxFileBytes = ref(2097152), maxFiles = ref(5)
const selectedFile = computed(() => files.value.find(file => file.id === fileId.value))
const displayEntries = computed(() => [...entries.value].reverse())
let controller, exportController, clearController, sequence = 0, exportSequence = 0, clearSequence = 0, timer, disposed = false, polling = false, mounted = false, programmaticScroll = false
let applyingFiles = false, needsFiles = true, userListLoaded = false

function filters() {
  return { fileId: fileId.value, userId: userId.value, level: level.value, keyword: keyword.value.trim(), page: page.value, pageSize: pageSize.value }
}
function time(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}
function size(value) {
  const bytes = Math.max(0, Number(value) || 0)
  return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1048576).toFixed(1)} MiB`
}
function fileName(id) { return id === 'current' ? '当前日志' : `历史日志 ${id}` }
function userName(id) { return users.value.find(user => user.id === id)?.name || id || '—' }
function levelClass(value) { return `severity-${String(value || 'debug').toLowerCase()}` }
function entryTitle(row) { return `接收时间：${time(row.receivedAt)}${row.sessionId ? `\n会话：${row.sessionId}` : ''}` }
function statusLabel() { return ({ online: '在线', loading: '读取中', paused: '已暂停', history: '历史日志', offline: '离线' })[status.value] || '离线' }
function canPoll() { return !disposed && !clearing.value && !polling && active.value && !hidden.value && !paused.value && fileId.value === 'current' && page.value === 1 }
function schedulePoll() {
  clearTimeout(timer)
  if (!canPoll()) return
  timer = setTimeout(() => { pollLatest() }, 5000)
}
function setEntries(data) {
  // 先锁定跟随意图，避免追加日志引起的布局滚动被误判为用户离开底部。
  const follow = autoScroll.value
  if (follow) programmaticScroll = true
  entries.value = Array.isArray(data.entries) ? data.entries : []
  if (follow) nextTick(() => scrollBottom(false))
}
const autoScroll = ref(true)

async function load(refreshFiles = false, options = {}) {
  const { preserve = false, background = false, manual = false } = options
  refreshFiles ||= needsFiles
  clearTimeout(timer)
  controller?.abort()
  const current = controller = new AbortController(), version = ++sequence
  polling = true
  if (!preserve) { loading.value = true; entries.value = []; total.value = 0 }
  if (!background) { refreshing.value = refreshFiles; error.value = ''; status.value = paused.value ? 'paused' : 'loading' }
  try {
    if (refreshFiles) {
      const fileResult = await api.frontendLogFiles(current.signal, userId.value)
      if (version !== sequence || current.signal.aborted) return
      if (!Array.isArray(fileResult.files)) throw new Error('日志文件列表格式无效')
      files.value = fileResult.files.filter(file => /^(current|[1-4])$/.test(file.id))
      maxFileBytes.value = fileResult.maxFileBytes; maxFiles.value = fileResult.maxFiles; needsFiles = false
      applyingFiles = true
      if (!files.value.some(file => file.id === fileId.value)) { fileId.value = files.value.find(file => file.id === 'current')?.id || 'current'; page.value = 1 }
      applyingFiles = false
      // 用户名单只在首次进入或显式手动刷新/重试时读取，不随五秒轮询请求。
      if (props.administrator && (!userListLoaded || manual || usersError.value)) {
        try {
          const list = await api.users(current.signal)
          if (version !== sequence || current.signal.aborted) return
          if (!Array.isArray(list)) throw new Error('用户列表格式无效')
          users.value = list; usersError.value = ''; userListLoaded = true
        } catch (e) { if (!current.signal.aborted) usersError.value = e.message || '用户列表读取失败，可刷新重试' }
      }
    }
    if (!fileId.value) fileId.value = 'current'
    const data = await api.frontendLogs(filters(), current.signal)
    if (version !== sequence || current.signal.aborted) return
    if (!Array.isArray(data.entries)) throw new Error('日志列表格式无效')
    const count = Math.max(0, Number(data.total) || 0), lastPage = Math.max(1, Math.ceil(count / pageSize.value))
    if (page.value > lastPage) { page.value = lastPage; return await load(false, { preserve, background }) }
    total.value = count; setEntries(data)
    status.value = paused.value ? 'paused' : fileId.value === 'current' && page.value === 1 ? 'online' : 'history'
    error.value = ''
  } catch (e) {
    if (version === sequence && !current.signal.aborted) { error.value = e.message || '日志读取失败'; status.value = paused.value ? 'paused' : 'offline' }
  } finally {
    if (version === sequence) {
      polling = false
      loading.value = false; refreshing.value = false
      schedulePoll()
    }
  }
}
async function pollLatest() {
  if (!canPoll()) return
  await load(true, { preserve: true, background: true })
}
function search() { if (!clearing.value) { page.value = 1; load(false) } }
function togglePause() {
  paused.value = !paused.value
  if (paused.value) { clearTimeout(timer); controller?.abort(); status.value = 'paused' }
  else { status.value = 'loading'; load(true, { manual: true }) }
}
function onVisibility() { hidden.value = document.hidden; if (hidden.value) { clearTimeout(timer); controller?.abort() } else if (active.value && !paused.value) load(true, { preserve: true, background: true }) }
function scrollBottom(explicit = true) {
  if (explicit) { autoScroll.value = true; page.value = 1; fileId.value = 'current'; load(true, { manual: true }); return }
  programmaticScroll = true
  nextTick(() => {
    if (logViewport.value) logViewport.value.scrollTop = logViewport.value.scrollHeight
    programmaticScroll = false
  })
}
function onViewportScroll(event) {
  if (programmaticScroll) return
  const viewport = event.currentTarget
  autoScroll.value = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 24
}
async function copyVisible() {
  const text = displayEntries.value.map(row => `[${time(row.timestamp)}] ${String(row.level || '').toUpperCase()} ${row.message || ''}`).join('\n')
  if (!text) return
  try {
    let copied = false
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); copied = true } } catch { /* 权限拒绝后继续使用传统复制。 */ }
    if (!copied) {
      const previous = document.activeElement
      const area = document.createElement('textarea')
      area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0'
      document.body.appendChild(area); area.focus({ preventScroll: true }); area.select()
      try { copied = document.execCommand('copy') } finally { area.remove(); if (previous && typeof previous.focus === 'function') previous.focus({ preventScroll: true }) }
      if (!copied) throw new Error('copy command failed')
    }
    ElMessage.success('已复制当前显示日志')
  } catch { ElMessage.error('复制失败，请检查浏览器剪贴板权限') }
}
async function clearLogs() {
  if (clearing.value || !userId.value) return
  const targetUser = userId.value, version = ++clearSequence
  clearing.value = true; clearError.value = ''; clearMessage.value = ''
  clearTimeout(timer); ++sequence; ++exportSequence; controller?.abort(); exportController?.abort(); polling = false; loading.value = false; refreshing.value = false; exporting.value = false
  try {
    await ElMessageBox.confirm(`将清空用户 ${userName(targetUser)} (${targetUser}) 的全部前端日志，包括当前文件和所有历史文件。此操作不可恢复，且不受当前筛选条件限制。`, '清空全部前端日志', { type: 'warning', confirmButtonText: '清空全部日志', cancelButtonText: '取消', closeOnClickModal: false })
    if (disposed || version !== clearSequence) return
    const current = clearController = new AbortController(); await api.clearFrontendLogs(targetUser, current.signal)
    if (disposed || version !== clearSequence || current.signal.aborted) return
    applyingFiles = true; fileId.value = 'current'; applyingFiles = false; page.value = 1; entries.value = []; files.value = []; total.value = 0; clearMessage.value = '已清空该用户全部前端日志'; needsFiles = true
    await load(true, { manual: true })
  } catch (e) {
    if (disposed || version !== clearSequence) return
    if (e === 'cancel' || e === 'close') await load(true, { manual: true }); else clearError.value = e.message || '清空日志失败，请刷新确认服务器状态'
  } finally { if (version === clearSequence) { clearing.value = false; schedulePoll() } }
}
async function exportLogs() {
  if (exporting.value || clearing.value || !selectedFile.value) return
  const snapshot = filters(), current = exportController = new AbortController(), version = ++exportSequence; exporting.value = true; exportError.value = ''
  try {
    const blob = await api.exportFrontendLogs(snapshot, current.signal)
    if (version !== exportSequence || current.signal.aborted) return
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `frontend-logs-${snapshot.fileId}.log`; document.body.appendChild(link)
    try { link.click() } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
  } catch (e) { if (version === exportSequence && !current.signal.aborted) exportError.value = e.message || '日志导出失败' }
  finally { if (version === exportSequence) exporting.value = false }
}
watch([fileId, userId, level, keyword, pageSize], (values, previous) => {
  if (applyingFiles || disposed || clearing.value) return
  clearTimeout(timer); controller?.abort(); ++sequence; loading.value = true; entries.value = []; total.value = 0; page.value = 1
  const userChanged = values[1] !== previous[1]
  if (userChanged) { needsFiles = true; ++exportSequence; exportController?.abort(); exporting.value = false; exportError.value = ''; clearError.value = ''; clearMessage.value = ''; files.value = []; applyingFiles = true; fileId.value = 'current'; applyingFiles = false; refreshing.value = true }
  const onlyKeyword = values.every((value, index) => index === 3 || value === previous[index])
  timer = setTimeout(() => load(userChanged, { manual: userChanged }), onlyKeyword ? 300 : 0)
}, { flush: 'sync' })
onMounted(() => { mounted = true; document.addEventListener('visibilitychange', onVisibility); load(true, { manual: true }) })
onActivated(() => { active.value = true; if (mounted && !paused.value && !hidden.value) load(true, { preserve: true, background: true }) })
onDeactivated(() => { active.value = false; clearTimeout(timer); controller?.abort(); ++sequence })
onBeforeUnmount(() => { disposed = true; active.value = false; document.removeEventListener('visibilitychange', onVisibility); ++sequence; ++exportSequence; ++clearSequence; clearTimeout(timer); controller?.abort(); exportController?.abort(); clearController?.abort() })
</script>

<template>
  <section class="frontend-logs" aria-labelledby="frontend-logs-title">
    <header class="logs-heading">
      <div class="heading-title"><span class="status-dot" :class="`status-${status}`" aria-hidden="true"></span><h2 id="frontend-logs-title">前端日志</h2><span class="status-label">{{ statusLabel() }}</span></div>
      <div class="logs-actions">
        <el-button text circle :icon="Refresh" :loading="refreshing" :disabled="clearing" title="刷新" aria-label="刷新" @click="load(true, { manual: true })" />
        <el-button text circle :icon="paused ? VideoPlay : VideoPause" :disabled="clearing" :title="paused ? '恢复自动刷新' : '暂停自动刷新'" :aria-label="paused ? '恢复自动刷新' : '暂停自动刷新'" @click="togglePause" />
        <el-button text circle :icon="CopyDocument" :disabled="!displayEntries.length" title="复制当前显示日志" aria-label="复制当前显示日志" @click="copyVisible" />
        <el-button text circle :icon="Download" :loading="exporting" :disabled="clearing || !selectedFile" title="导出日志文本" aria-label="导出日志文本" @click="exportLogs" />
        <el-button text circle :icon="Bottom" :disabled="clearing" title="滚动到底部并查看最新" aria-label="滚动到底部并查看最新" @click="scrollBottom" />
        <el-button text circle :icon="Delete" :loading="clearing" :disabled="clearing || !files.length" title="清空全部日志" aria-label="清空全部日志" @click="clearLogs" />
      </div>
    </header>
    <div v-if="error || usersError || exportError || clearError || clearMessage" class="logs-notices"><el-alert v-if="error" :title="error" type="error" :closable="false" show-icon /><el-alert v-if="usersError" :title="usersError" type="warning" :closable="false" show-icon /><el-alert v-if="exportError" :title="exportError" type="error" :closable="false" show-icon /><el-alert v-if="clearError" :title="clearError" type="error" :closable="false" show-icon /><el-alert v-if="clearMessage" :title="clearMessage" type="success" :closable="false" show-icon /></div>
    <div class="logs-filter-row primary-filter-row">
      <div class="severity-filter" role="group" aria-label="日志级别"><button v-for="item in ['','info','warn','error','debug']" :key="item || 'all'" type="button" :class="{ selected: level === item, [`segment-${item || 'all'}`]: true }" :disabled="clearing || refreshing" @click="level = item">{{ item ? item.toUpperCase() : 'ALL' }}</button></div>
      <label class="search-filter"><span>搜索</span><el-input v-model="keyword" clearable :disabled="clearing || refreshing" placeholder="搜索日志消息" aria-label="日志关键字" @keyup.enter="search"><template #prefix><el-icon><Search /></el-icon></template></el-input></label>
    </div>
    <div class="logs-filter-row secondary-filter-row">
      <label class="file-filter">日志文件<el-select v-model="fileId" :disabled="clearing || refreshing || !files.length" aria-label="日志文件"><el-option v-for="file in files" :key="file.id" :value="file.id" :label="`${fileName(file.id)} · ${size(file.sizeBytes)}`" /></el-select></label>
      <label v-if="props.administrator">用户<el-select v-model="userId" filterable :disabled="clearing || refreshing" aria-label="日志所属用户"><el-option v-if="!users.some(user => user.id === props.currentUserId)" label="当前用户" :value="props.currentUserId" /><el-option v-for="user in users" :key="user.id" :value="user.id" :label="`${user.name} (${user.id})`" /></el-select></label>
      <span v-else class="actor-readonly">当前用户 <strong>{{ userName(props.currentUserId) }}</strong></span>
      <span class="file-meta" v-if="selectedFile" :title="`每文件 ${size(maxFileBytes)}，最多 ${maxFiles} 个文件`">{{ fileName(selectedFile.id) }} · {{ size(selectedFile.sizeBytes) }} · 更新于 {{ time(selectedFile.updatedAt) }}</span>
      <el-checkbox v-model="showSession">显示会话详情</el-checkbox>
    </div>
    <div class="logs-summary"><span>共 {{ total }} 条 · 显示 {{ displayEntries.length }} 条</span><span v-if="!props.administrator">仅显示当前用户日志</span></div>
    <div
      ref="logViewport"
      class="log-viewport"
      :class="{ 'is-loading': loading }"
      role="log"
      aria-live="polite"
      @scroll="onViewportScroll"
    >
      <div v-if="loading && !displayEntries.length" class="log-empty">正在读取日志…</div>
      <div v-else-if="!displayEntries.length" class="log-empty">{{ error ? '日志读取失败，请刷新重试' : files.length ? '没有符合条件的日志' : '暂无日志文件' }}</div>
      <article
        v-for="(row, index) in displayEntries"
        :key="row.id || `${row.timestamp}-${index}`"
        class="log-entry"
        :class="levelClass(row.level)"
        :title="entryTitle(row)"
      >
        <div class="entry-head"><time>{{ time(row.timestamp) }}</time><span class="severity-badge">{{ String(row.level || 'debug').toUpperCase() }}</span></div>
        <div class="log-message">{{ row.message }}</div>
        <div v-if="showSession && (row.receivedAt || row.sessionId)" class="entry-detail">{{ time(row.receivedAt) }}<span v-if="row.sessionId"> · {{ row.sessionId }}</span></div>
      </article>
    </div>
    <footer class="logs-pagination"><label>每页<el-select v-model="pageSize" :disabled="clearing || refreshing" aria-label="每页日志条数"><el-option v-for="value in [50, 100, 200]" :key="value" :value="value" :label="`${value} 条`" /></el-select></label><el-checkbox v-model="autoScroll">自动跟随最新</el-checkbox><el-pagination v-model:current-page="page" :total="total" :page-size="pageSize" :pager-count="5" :disabled="clearing || loading" layout="prev, pager, next" @current-change="load()" /></footer>
  </section>
</template>

<style scoped>
.frontend-logs { min-width: 0; min-height: 0; flex: 1 1 0; display: flex; flex-direction: column; overflow: hidden; color: var(--el-text-color-primary); }
.frontend-logs > :not(.log-viewport) { flex-shrink: 0; }
/* 日志正文接管剩余高度，取消固定 vh 高度造成的页面溢出。 */
.frontend-logs .log-viewport { flex: 1 1 0; height: 0; min-height: 0; overscroll-behavior: contain; }
.frontend-logs .logs-pagination { margin-top: 0; }
.logs-heading, .heading-title, .logs-actions, .secondary-filter-row, .logs-pagination { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.logs-heading { justify-content: space-between; padding: 2px 0 14px; border-bottom: 1px solid var(--el-border-color-lighter); }
.heading-title h2 { margin: 0; font-size: 17px; font-weight: 650; }.status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--el-color-info); }.status-online { background: var(--el-color-success); }.status-loading { background: var(--el-color-warning); }.status-paused { background: var(--el-color-info); }.status-offline { background: var(--el-color-danger); }.status-history { background: var(--el-color-primary); }.status-label { color: var(--el-text-color-secondary); font-size: 12px; }
.logs-actions { gap: 2px; }.logs-actions .el-button { margin: 0; }.logs-notices .el-alert { margin: 10px 0; }
.logs-filter-row { display: flex; align-items: end; gap: 12px; flex-wrap: wrap; }.primary-filter-row { padding: 14px 0 8px; }.secondary-filter-row { min-height: 34px; color: var(--el-text-color-secondary); font-size: 12px; }.logs-filter-row label { display: flex; flex-direction: column; gap: 5px; min-width: 0; font-size: 12px; }.file-filter { width: min(300px, 100%); }.search-filter { flex: 1 1 220px; max-width: 420px; }.secondary-filter-row label { width: min(260px, 100%); }.actor-readonly { padding: 8px 0; }.actor-readonly strong { color: var(--el-text-color-primary); font-weight: 500; }.file-meta { margin-left: auto; overflow-wrap: anywhere; }.secondary-filter-row .el-checkbox { margin-left: 4px; }
.severity-filter { display: flex; align-items: stretch; padding-top: 17px; }.severity-filter button { height: 32px; padding: 0 10px; border: 1px solid var(--el-border-color); border-left: 0; background: var(--el-fill-color-blank); color: var(--el-text-color-secondary); font-size: 11px; cursor: pointer; }.severity-filter button:first-child { border-left: 1px solid var(--el-border-color); border-radius: 5px 0 0 5px; }.severity-filter button:last-child { border-radius: 0 5px 5px 0; }.severity-filter button.selected { color: var(--el-color-primary); background: var(--el-color-primary-light-9); border-color: var(--el-color-primary); }.severity-filter button:disabled { cursor: not-allowed; opacity: .6; }
.logs-summary { display: flex; justify-content: space-between; gap: 10px; margin: 12px 0 8px; color: var(--el-text-color-secondary); font-size: 12px; }.log-viewport { height: min(60vh, 620px); min-height: 300px; overflow: auto; padding: 4px 6px 8px 2px; border-top: 1px solid var(--el-border-color-lighter); border-bottom: 1px solid var(--el-border-color-lighter); scrollbar-gutter: stable; }.log-empty { display: grid; min-height: 220px; place-items: center; color: var(--el-text-color-secondary); font-size: 13px; }.log-entry { position: relative; margin: 6px 2px; padding: 9px 12px 9px 14px; border: 1px solid var(--el-border-color-lighter); border-radius: 5px; background: var(--el-bg-color); overflow: hidden; }.log-entry::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--el-color-info); }.log-entry.severity-info::before { background: var(--el-color-primary); }.log-entry.severity-warn::before { background: var(--el-color-warning); }.log-entry.severity-error::before { background: var(--el-color-danger); }.entry-head { display: flex; align-items: center; gap: 8px; color: var(--el-text-color-secondary); font-size: 12px; }.severity-badge { padding: 1px 5px; border-radius: 3px; background: var(--el-fill-color-light); color: var(--el-text-color-secondary); font-size: 11px; font-weight: 650; }.severity-info .severity-badge { color: var(--el-color-primary); background: var(--el-color-primary-light-9); }.severity-warn .severity-badge { color: var(--el-color-warning-dark-2); background: var(--el-color-warning-light-9); }.severity-error .severity-badge { color: var(--el-color-danger); background: var(--el-color-danger-light-9); }.log-message { margin-top: 5px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; line-height: 1.55; font-size: 13px; }.entry-detail { margin-top: 5px; color: var(--el-text-color-secondary); font-size: 11px; overflow-wrap: anywhere; }
.logs-pagination { justify-content: space-between; padding-top: 12px; }.logs-pagination label { display: flex; align-items: center; gap: 7px; font-size: 12px; }.logs-pagination .el-select { width: 90px; }.logs-pagination .el-pagination { margin-left: auto; max-width: 100%; }
/* 手机端统一工具触控尺寸，避免全局最小高度把圆形图标按钮拉成椭圆。 */
@media (max-width: 640px) { .logs-actions .el-button { width: 44px; height: 44px; min-height: 44px; flex: 0 0 44px; } .log-viewport { height: 55vh; min-height: 240px; }.file-filter, .secondary-filter-row label { width: 100%; }.severity-filter { padding-top: 0; width: 100%; }.severity-filter button { flex: 1; }.search-filter { max-width: none; width: 100%; }.file-meta { margin-left: 0; }.logs-summary { align-items: flex-start; flex-direction: column; }.logs-pagination { align-items: flex-start; }.logs-pagination .el-pagination { flex-basis: 100%; margin-left: 0; } }
</style>
