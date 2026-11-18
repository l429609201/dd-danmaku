<template>
  <div class="page">
    <div class="page-header">
      <h1 class="page-title">日志中心</h1>
    </div>

    <el-tabs v-model="activeTab" @tab-change="onTabChange">
      <!-- Tab 1: Worker 数据库日志 -->
      <el-tab-pane label="Worker 日志" name="worker">
        <div class="toolbar">
          <el-select v-model="workerFilter.level" placeholder="日志级别" clearable style="width:120px" @change="loadWorkerLogs">
            <el-option label="全部" value="" />
            <el-option label="DEBUG" value="DEBUG" />
            <el-option label="INFO" value="INFO" />
            <el-option label="WARN" value="WARN" />
            <el-option label="ERROR" value="ERROR" />
          </el-select>
          <el-input v-model="workerFilter.node_id" placeholder="节点 ID" clearable style="width:160px" @clear="loadWorkerLogs" @keyup.enter="loadWorkerLogs" />
          <el-button size="small" @click="loadWorkerLogs">查询</el-button>
          <el-button size="small" @click="workerPage = 1; loadWorkerLogs()">首页</el-button>
          <span class="pager-info">第 {{ workerPage }} 页 · 共 {{ workerTotal }} 条</span>
          <el-button size="small" :disabled="workerHasMore" @click="workerPage++; loadWorkerLogs()">下一页</el-button>
        </div>
        <div v-if="workerLoading" class="loading">加载中…</div>
        <div v-else-if="workerLogs.length === 0" class="empty">暂无日志</div>
        <el-table v-else :data="workerLogs" stripe size="small" style="width:100%" :row-key="r => r.id">
          <el-table-column prop="created_at" label="时间" width="180" :formatter="r => fmtTime(r.created_at)" />
          <el-table-column prop="level" label="级别" width="80">
            <template #default="{ row }">
              <el-tag :type="levelTagType(row.level)" size="small">{{ row.level }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="node_id" label="节点" width="120" />
          <el-table-column prop="message" label="消息" show-overflow-tooltip />
          <el-table-column type="expand" width="40">
            <template #default="{ row }">
              <pre v-if="row.extra_data" class="expand-text">{{ row.extra_data }}</pre>
              <span v-else class="expand-text">无额外数据</span>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Tab 2: 服务器文件日志 -->
      <el-tab-pane label="服务器日志" name="server">
        <div class="toolbar">
          <el-switch v-model="serverStreamMode" active-text="实时" inactive-text="历史" @change="toggleStreamMode" style="margin-right:12px" />
          <el-select v-model="serverFilter.file" placeholder="选择日志文件" style="width:260px" @change="serverStreamMode ? connectServerLogStream() : loadServerLogs()">
            <el-option v-for="f in serverFiles" :key="f.name" :label="`${f.name} (${fmtBytes(f.size_bytes)})`" :value="f.name" />
          </el-select>
          <el-select v-model="serverFilter.level" placeholder="级别" clearable style="width:100px" @change="serverStreamMode ? connectServerLogStream() : loadServerLogs()">
            <el-option label="全部" value="" />
            <el-option label="ERROR" value="ERROR" />
            <el-option label="WARN" value="WARN" />
            <el-option label="INFO" value="INFO" />
            <el-option label="DEBUG" value="DEBUG" />
          </el-select>
          <el-input v-model="serverFilter.keyword" placeholder="关键词搜索" clearable style="width:180px" 
            @clear="serverStreamMode ? connectServerLogStream() : loadServerLogs()" 
            @keyup.enter="serverStreamMode ? connectServerLogStream() : loadServerLogs()" />
          <el-button v-if="!serverStreamMode" size="small" @click="serverFilter.page = 1; loadServerLogs()">查询</el-button>
          <el-tag v-if="serverStreamMode" :type="serverStreamStatus === 'connected' ? 'success' : serverStreamStatus === 'connecting' ? 'info' : 'danger'" size="small">
            {{ serverStreamStatus === 'connected' ? '已连接' : serverStreamStatus === 'connecting' ? '连接中' : '连接失败' }}
          </el-tag>
          <template v-if="!serverStreamMode">
            <span class="pager-info">第 {{ serverFilter.page }} 页 · 共 {{ serverTotalLines }} 行</span>
            <el-button size="small" :disabled="!serverHasMore" @click="serverFilter.page++; loadServerLogs()">下一页</el-button>
          </template>
          <el-button size="small" @click="loadServerLogFiles">刷新文件列表</el-button>
        </div>
        
        <!-- 实时模式 -->
        <div v-if="serverStreamMode" class="server-log-stream">
          <div v-if="serverStreamEntries.length === 0" class="empty">等待新日志...</div>
          <div v-else class="log-list">
            <div v-for="(entry, idx) in serverStreamEntries" :key="idx" class="log-row" :class="`log-row--${(entry.level || 'info').toLowerCase()}`">
              <span class="log-time">{{ entry.timestamp || '—' }}</span>
              <el-tag :type="levelTagType(entry.level)" size="small" class="log-level">{{ entry.level || '?' }}</el-tag>
              <span class="log-target" v-if="entry.target">{{ entry.target }}</span>
              <span class="log-message">{{ entry.message }}</span>
            </div>
          </div>
        </div>
        
        <!-- 历史模式 -->
        <div v-else>
          <div v-if="serverLoading" class="loading">加载中…</div>
          <div v-else-if="serverEntries.length === 0" class="empty">暂无日志</div>
          <div v-else class="log-list">
            <div v-for="(entry, idx) in serverEntries" :key="idx" class="log-row" :class="`log-row--${(entry.level || 'info').toLowerCase()}`">
              <span class="log-time">{{ entry.timestamp || '—' }}</span>
              <el-tag :type="levelTagType(entry.level)" size="small" class="log-level">{{ entry.level || '?' }}</el-tag>
              <span class="log-target" v-if="entry.target">{{ entry.target }}</span>
              <span class="log-message">{{ entry.message || entry.raw }}</span>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <!-- Tab 3: 运行事件 -->
      <el-tab-pane label="运行事件" name="events">
        <div class="toolbar">
          <el-button size="small" @click="loadEvents">刷新</el-button>
          <span class="pager-info">第 {{ eventPage }} 页 · 共 {{ eventTotal }} 条</span>
          <el-button size="small" :disabled="!eventHasMore" @click="eventPage++; loadEvents()">下一页</el-button>
        </div>
        <div v-if="eventLoading" class="loading">加载中…</div>
        <div v-else-if="events.length === 0" class="empty">暂无事件</div>
        <el-table v-else :data="events" stripe size="small" style="width:100%">
          <el-table-column prop="created_at" label="时间" width="180" :formatter="r => fmtTime(r.created_at)" />
          <el-table-column prop="event_type" label="类型" width="140" />
          <el-table-column prop="severity" label="级别" width="80">
            <template #default="{ row }">
              <el-tag :type="severityTagType(row.severity)" size="small">{{ row.severity || '—' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="message" label="消息" show-overflow-tooltip />
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, computed, nextTick } from 'vue'
import { apiV2 } from '@/utils/api'

const activeTab = ref('worker')

// ===== Worker 日志 =====
const workerLogs = ref([])
const workerLoading = ref(false)
const workerPage = ref(1)
const workerPageSize = ref(20)
const workerTotal = ref(0)
const workerFilter = ref({ level: '', node_id: '' })

const workerHasMore = computed(() => workerPage.value * workerPageSize.value >= workerTotal.value)

async function loadWorkerLogs() {
  workerLoading.value = true
  try {
    const params = new URLSearchParams({ page: String(workerPage.value), page_size: String(workerPageSize.value) })
    if (workerFilter.value.level) params.set('level', workerFilter.value.level)
    if (workerFilter.value.node_id) params.set('node_id', workerFilter.value.node_id)
    const res = await apiV2(`/logs/worker-logs?${params}`)
    workerLogs.value = res.items ?? res.data ?? []
    workerTotal.value = res.total ?? workerLogs.value.length
  } catch (e) {
    console.error('Worker 日志加载失败', e)
    workerLogs.value = []
  } finally {
    workerLoading.value = false
  }
}

// ===== 服务器日志 =====
const serverFiles = ref([])
const serverEntries = ref([])
const serverLoading = ref(false)
const serverTotalLines = ref(0)
const serverFilter = ref({ file: '', level: '', keyword: '', page: 1, page_size: 100 })
// SSE 实时模式
const serverStreamMode = ref(true)
const serverStreamEntries = ref([])
const serverStreamConnection = ref(null)
const serverStreamStatus = ref('disconnected')

const serverHasMore = computed(() => serverFilter.value.page * serverFilter.value.page_size < serverTotalLines.value)

async function loadServerLogFiles() {
  try {
    const res = await apiV2('/logs/server-files')
    serverFiles.value = res.files ?? []
    // 自动选择当天的文件
    const today = serverFiles.value.find(f => f.is_today)
    if (today && !serverFilter.value.file) {
      serverFilter.value.file = today.name
      await loadServerLogs()
    }
  } catch (e) {
    console.error('日志文件列表加载失败', e)
    serverFiles.value = []
  }
}

async function loadServerLogs() {
  if (!serverFilter.value.file) {
    serverEntries.value = []
    return
  }
  serverLoading.value = true
  try {
    const params = new URLSearchParams({
      file: serverFilter.value.file,
      page: String(serverFilter.value.page),
      page_size: String(serverFilter.value.page_size),
    })
    if (serverFilter.value.level) params.set('level', serverFilter.value.level)
    if (serverFilter.value.keyword) params.set('keyword', serverFilter.value.keyword)
    const res = await apiV2(`/logs/server-logs?${params}`)
    serverEntries.value = res.entries ?? []
    serverTotalLines.value = res.total_lines ?? 0
  } catch (e) {
    console.error('服务器日志加载失败', e)
    serverEntries.value = []
  } finally {
    serverLoading.value = false
  }
}

function connectServerLogStream() {
  if (serverStreamConnection.value) {
    serverStreamConnection.value.close()
  }
  
  serverStreamStatus.value = 'connecting'
  const params = new URLSearchParams()
  if (serverFilter.value.file) params.set('file', serverFilter.value.file)
  if (serverFilter.value.level) params.set('level', serverFilter.value.level)
  if (serverFilter.value.keyword) params.set('keyword', serverFilter.value.keyword)
  // EventSource 不支持自定义请求头，通过 query 参数传递 JWT token 完成鉴权
  const token = localStorage.getItem('access_token')
  if (token) params.set('token', token)
  
  const url = `/api/v2/logs/server-logs/stream?${params}`
  const eventSource = new EventSource(url)
  
  eventSource.onopen = () => {
    serverStreamStatus.value = 'connected'
  }
  
  eventSource.onmessage = (event) => {
    if (event.data === 'keepalive') return
    try {
      const entry = JSON.parse(event.data)
      serverStreamEntries.value.push(entry)
      if (serverStreamEntries.value.length > 500) {
        serverStreamEntries.value.shift()
      }
      nextTick(() => {
        const container = document.querySelector('.server-log-stream')
        if (container) {
          container.scrollTop = container.scrollHeight
        }
      })
    } catch (e) {
      console.error('解析日志失败', e)
    }
  }
  
  eventSource.addEventListener('file_rotated', (event) => {
    console.log('日志文件轮转:', event.data)
  })
  
  // EventSource 断开时会自动以指数退避重连（浏览器原生行为），
  // 不再手动调用 connectServerLogStream()，避免与原生重连叠加导致双重连接
  eventSource.onerror = () => {
    serverStreamStatus.value = 'error'
    // 状态由 onopen 在重连成功后自动恢复为 'connected'
  }
  
  serverStreamConnection.value = eventSource
}

function disconnectServerLogStream() {
  if (serverStreamConnection.value) {
    serverStreamConnection.value.close()
    serverStreamConnection.value = null
  }
  serverStreamStatus.value = 'disconnected'
  serverStreamEntries.value = []
}

function toggleStreamMode() {
  if (serverStreamMode.value) {
    disconnectServerLogStream()
    serverStreamEntries.value = []
    connectServerLogStream()
  } else {
    disconnectServerLogStream()
    loadServerLogs()
  }
}

// ===== 运行事件 =====
const events = ref([])
const eventLoading = ref(false)
const eventPage = ref(1)
const eventPageSize = ref(20)
const eventTotal = ref(0)

const eventHasMore = computed(() => eventPage.value * eventPageSize.value < eventTotal.value)

async function loadEvents() {
  eventLoading.value = true
  try {
    const res = await apiV2(`/admin/events?page=${eventPage.value}&page_size=${eventPageSize.value}`)
    events.value = res.items ?? res.data ?? []
    eventTotal.value = res.total ?? events.value.length
  } catch (e) {
    console.error('运行事件加载失败', e)
    events.value = []
  } finally {
    eventLoading.value = false
  }
}

// ===== 工具函数 =====
function fmtTime(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

function fmtBytes(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function levelTagType(level) {
  const l = (level || '').toUpperCase()
  if (l === 'ERROR') return 'danger'
  if (l === 'WARN' || l === 'WARNING') return 'warning'
  if (l === 'INFO') return 'info'
  if (l === 'DEBUG') return ''
  return ''
}

function severityTagType(severity) {
  const s = (severity || '').toLowerCase()
  if (s === 'critical' || s === 'error') return 'danger'
  if (s === 'warning') return 'warning'
  if (s === 'info') return 'info'
  return ''
}

function onTabChange(tab) {
  if (tab === 'worker' && workerLogs.value.length === 0) loadWorkerLogs()
  if (tab === 'server') {
    if (serverFiles.value.length === 0) {
      loadServerLogFiles().then(() => {
        if (serverStreamMode.value) connectServerLogStream()
      })
    } else if (serverStreamMode.value && serverStreamStatus.value === 'disconnected') {
      connectServerLogStream()
    }
  } else {
    // 离开服务器日志选项卡时断开 SSE
    disconnectServerLogStream()
  }
  if (tab === 'events' && events.value.length === 0) loadEvents()
}

onMounted(() => {
  loadWorkerLogs()
})

onBeforeUnmount(() => {
  disconnectServerLogStream()
})
</script>

<style scoped>
.page {
  padding: var(--spacing-lg);
  max-width: 1200px;
}

.page-header {
  margin-bottom: var(--spacing-md);
}

.page-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
  flex-wrap: wrap;
}

.pager-info {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin-left: auto;
}

.loading,
.empty {
  color: var(--color-text-placeholder);
  font-size: 13px;
  padding: var(--spacing-md);
  text-align: center;
}

.expand-text {
  font-size: 12px;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
  padding: 8px 16px;
}

/* 服务器日志行 */
.server-log-stream {
  background: var(--color-bg-overlay);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  max-height: 600px;
  overflow-y: auto;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
}

.log-list {
  background: var(--color-bg-overlay);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  max-height: 600px;
  overflow-y: auto;
  font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
}

.log-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 12px;
  border-bottom: 1px solid var(--color-border-light, var(--color-border));
}

.log-row:hover {
  background: var(--color-bg-elevated);
}

.log-row--error {
  background: rgba(245, 108, 108, 0.05);
}

.log-row--warn {
  background: rgba(230, 162, 60, 0.05);
}

.log-time {
  color: var(--color-text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
}

.log-level {
  flex-shrink: 0;
}

.log-target {
  color: var(--color-text-placeholder);
  white-space: nowrap;
  flex-shrink: 0;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.log-message {
  color: var(--color-text);
  white-space: pre-wrap;
  word-break: break-all;
  flex: 1;
}
</style>
