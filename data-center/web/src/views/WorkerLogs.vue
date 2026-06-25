<template>
  <div class="app-page">
    <h1 class="app-page__title">Worker 日志</h1>

    <div class="app-toolbar">
      <el-select v-model="level" placeholder="全部级别" clearable style="width: 130px" @change="reload">
        <el-option label="INFO" value="INFO" />
        <el-option label="WARN" value="WARN" />
        <el-option label="ERROR" value="ERROR" />
      </el-select>
      <el-input v-model="keyword" placeholder="搜索 path" clearable style="width: 200px" @keyup.enter="reload" />
      <el-button type="primary" :icon="Search" @click="reload">查询</el-button>
      <div class="app-toolbar__spacer" />
      <el-switch v-model="streaming" active-text="实时" @change="toggleStream" />
    </div>

    <el-card shadow="never">
      <el-table :data="items" size="small" v-loading="loading" empty-text="暂无日志"
                :row-class-name="rowClass" max-height="600">
        <el-table-column label="时间" width="180">
          <template #default="{ row }">{{ fmt(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="级别" width="90">
          <template #default="{ row }">
            <el-tag :type="levelType(row.level)" size="small">{{ row.level }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="worker_id" label="Worker" width="120">
          <template #default="{ row }">{{ row.worker_id || '—' }}</template>
        </el-table-column>
        <el-table-column label="IP" width="130">
          <template #default="{ row }"><span class="app-mono">{{ row.client_ip || '—' }}</span></template>
        </el-table-column>
        <el-table-column prop="method" label="方法" width="80">
          <template #default="{ row }">{{ row.method || '—' }}</template>
        </el-table-column>
        <el-table-column label="路径" min-width="200">
          <template #default="{ row }"><span class="app-mono">{{ row.path || '—' }}</span></template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }">{{ row.status || '—' }}</template>
        </el-table-column>
        <el-table-column label="缓存来源" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.cache_source" :type="sourceType(row.cache_source)" size="small">{{ row.cache_source }}</el-tag>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="耗时" width="80">
          <template #default="{ row }">{{ row.duration_ms != null ? row.duration_ms + 'ms' : '—' }}</template>
        </el-table-column>
        <el-table-column label="密钥" width="100">
          <template #default="{ row }"><span class="app-mono">{{ row.key_id || '—' }}</span></template>
        </el-table-column>
        <el-table-column prop="message" label="消息" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.message || '—' }}</template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script>
import { ref, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { apiV2, getAuthHeaders } from '../utils/api.js'

export default {
  name: 'WorkerLogs',
  setup() {
    const items = ref([])
    const level = ref('')
    const keyword = ref('')
    const loading = ref(false)
    const streaming = ref(false)
    let abortCtrl = null

    const reload = async () => {
      loading.value = true
      try {
        const q = new URLSearchParams({ page: 1, page_size: 100 })
        if (level.value) q.set('level', level.value)
        if (keyword.value) q.set('keyword', keyword.value)
        const res = await apiV2(`/worker-logs?${q.toString()}`)
        items.value = res.items || []
      } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
    }

    // fetch 流式读取 SSE（可携带 Authorization 头，EventSource 不支持自定义头）
    const startStream = async () => {
      abortCtrl = new AbortController()
      try {
        const resp = await fetch('/api/v2/worker-logs/stream', {
          headers: { ...getAuthHeaders() }, signal: abortCtrl.signal,
        })
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (streaming.value) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split('\n\n')
          buffer = parts.pop()
          for (const part of parts) {
            const line = part.split('\n').find(l => l.startsWith('data: '))
            if (!line) continue
            try {
              const item = JSON.parse(line.slice(6))
              item._live = true
              items.value.unshift(item)
              if (items.value.length > 200) items.value.pop()
            } catch { /* 忽略心跳 */ }
          }
        }
      } catch (e) {
        if (streaming.value) ElMessage.warning('实时连接中断: ' + e.message)
      }
    }
    const toggleStream = (on) => {
      if (on) startStream()
      else if (abortCtrl) abortCtrl.abort()
    }

    const levelType = (l) => ({ ERROR: 'danger', WARN: 'warning', INFO: 'success' }[l] || 'info')
    // 缓存来源标签色：命中类绿色、MISS 灰、限流红
    const sourceType = (s) => {
      if (!s) return 'info'
      if (s.indexOf('429') >= 0 || s.indexOf('STALE') >= 0) return 'warning'
      if (s === 'MISS' || s === 'UPSTREAM-429') return s === 'MISS' ? 'info' : 'danger'
      return 'success'
    }
    const rowClass = ({ row }) => (row._live ? 'live-row' : '')
    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')

    onMounted(reload)
    onUnmounted(() => { streaming.value = false; if (abortCtrl) abortCtrl.abort() })
    return { items, level, keyword, loading, streaming, Search,
      reload, toggleStream, levelType, sourceType, rowClass, fmt }
  }
}
</script>

<style scoped>
:deep(.live-row) { background: #f6ffed; }
</style>