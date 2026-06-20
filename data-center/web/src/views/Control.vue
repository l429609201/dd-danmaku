<template>
  <div class="app-page">
    <h1 class="app-page__title">Worker 连接与控制</h1>

    <div class="app-toolbar">
      <el-button :icon="Refresh" @click="load">刷新</el-button>
      <el-button type="primary" :icon="Connection" :loading="reconnecting" @click="reconnect">手动重连</el-button>
      <el-tag :type="liveConnected ? 'success' : 'info'" effect="dark">
        实时连接: {{ liveConnected ? '已连接' : '未连接' }}
      </el-tag>
      <div class="app-toolbar__spacer" />
      <el-switch v-model="autoRefresh" active-text="自动刷新" @change="onAutoRefresh" />
    </div>

    <el-card shadow="never" class="mb16">
      <template #header>长连接节点</template>
      <el-table :data="nodes" size="small" v-loading="loading" empty-text="暂无节点">
        <el-table-column prop="node_id" label="节点" width="160" />
        <el-table-column prop="worker_id" label="Worker" width="140" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.connected ? 'success' : 'info'" size="small">
              {{ row.connected ? '在线' : '离线' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最近心跳" width="180">
          <template #default="{ row }">{{ fmt(row.last_seen_at) }}</template>
        </el-table-column>
        <el-table-column prop="reconnect_count" label="重连次数" width="100" />
        <el-table-column prop="last_error" label="错误" show-overflow-tooltip>
          <template #default="{ row }">{{ row.last_error || '—' }}</template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="card-head">
          <span>消息审计</span>
          <div class="filters">
            <el-select v-model="direction" placeholder="方向" clearable size="small" style="width: 150px" @change="load">
              <el-option label="Worker→本地" value="worker_to_local" />
              <el-option label="本地→Worker" value="local_to_worker" />
            </el-select>
            <el-input v-model="messageType" placeholder="消息类型" clearable size="small" style="width: 160px" @keyup.enter="load" />
            <el-select v-model="status" placeholder="状态" clearable size="small" style="width: 120px" @change="load">
              <el-option label="success" value="success" />
              <el-option label="failed" value="failed" />
              <el-option label="timeout" value="timeout" />
              <el-option label="pending" value="pending" />
            </el-select>
          </div>
        </div>
      </template>
      <el-table :data="messages" size="small" empty-text="暂无消息">
        <el-table-column prop="direction" label="方向" width="140" />
        <el-table-column prop="message_type" label="类型" width="150" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="request_cache_key" label="cache_key" show-overflow-tooltip>
          <template #default="{ row }">{{ row.request_cache_key || '—' }}</template>
        </el-table-column>
        <el-table-column label="耗时" width="90">
          <template #default="{ row }">{{ row.duration_ms }}ms</template>
        </el-table-column>
        <el-table-column label="时间" width="180">
          <template #default="{ row }">{{ fmt(row.created_at) }}</template>
        </el-table-column>
      </el-table>
      <div class="app-pager">
        <el-pagination layout="prev, pager, next, total" :total="total"
                       :page-size="pageSize" :current-page="page"
                       @current-change="onPage" />
      </div>
    </el-card>
  </div>
</template>

<script>
import { ref, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh, Connection } from '@element-plus/icons-vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'Control',
  setup() {
    const nodes = ref([])
    const messages = ref([])
    const liveConnected = ref(false)
    const loading = ref(false)
    const reconnecting = ref(false)
    const autoRefresh = ref(false)
    const direction = ref('')
    const messageType = ref('')
    const status = ref('')
    const page = ref(1)
    const pageSize = ref(50)
    const total = ref(0)
    let timer = null

    const load = async () => {
      loading.value = true
      try {
        const res = await apiV2('/control/nodes')
        nodes.value = res.data.nodes || []
        liveConnected.value = !!res.data.live_connected
        const q = new URLSearchParams({ page: page.value, page_size: pageSize.value })
        if (direction.value) q.set('direction', direction.value)
        if (messageType.value) q.set('message_type', messageType.value)
        if (status.value) q.set('status', status.value)
        const m = await apiV2(`/control/messages?${q.toString()}`)
        messages.value = m.items || []
        total.value = m.total || 0
      } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
    }

    const reconnect = async () => {
      reconnecting.value = true
      try {
        const res = await apiV2('/control/reconnect', { method: 'POST' })
        ElMessage.success(res.message || '已触发重连')
        setTimeout(load, 1000)
      } catch (e) { ElMessage.error(e.message) } finally { reconnecting.value = false }
    }

    const onPage = (p) => { page.value = p; load() }
    const onAutoRefresh = (on) => {
      if (on) timer = setInterval(load, 5000)
      else if (timer) { clearInterval(timer); timer = null }
    }
    const statusType = (s) => ({ success: 'success', failed: 'danger', timeout: 'warning', pending: 'info' }[s] || 'info')
    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')

    onMounted(load)
    onUnmounted(() => { if (timer) clearInterval(timer) })
    return { nodes, messages, liveConnected, loading, reconnecting, autoRefresh,
      direction, messageType, status, page, pageSize, total,
      Refresh, Connection, load, reconnect, onPage, onAutoRefresh, statusType, fmt }
  }
}
</script>

<style scoped>
.mb16 { margin-bottom: 16px; }
.card-head { display: flex; justify-content: space-between; align-items: center; }
.filters { display: flex; gap: 8px; }
</style>