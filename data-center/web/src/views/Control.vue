<template>
  <div class="app-page">
    <h1 class="app-page__title">Worker 连接与控制</h1>

    <div class="app-toolbar">
      <el-button :icon="Refresh" @click="load">刷新</el-button>
      <el-button type="primary" :icon="Connection" :loading="reconnecting" title="Rust 后端尚未提供手动重连接口" @click="reconnect">手动重连（待实现）</el-button>
      <el-tag :type="liveConnected ? 'success' : 'info'" effect="dark">
        实时连接: {{ liveConnected === null ? '后端尚未提供实时状态' : liveConnected ? '已连接' : '未连接' }}
      </el-tag>
      <div class="app-toolbar__spacer" />
      <el-switch v-model="autoRefresh" active-text="自动刷新" @change="onAutoRefresh" />
    </div>

    <el-card shadow="never" class="mb16">
      <template #header>长连接节点（数据库记录，非实时连接探针）</template>
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
            <el-select v-model="direction" placeholder="方向" clearable size="small" style="width: 150px" @change="reload">
              <el-option label="Worker→本地" value="worker_to_local" />
              <el-option label="本地→Worker" value="local_to_worker" />
            </el-select>
            <el-input v-model="messageType" placeholder="消息类型" clearable size="small" style="width: 160px" @keyup.enter="reload" @clear="reload" />
            <el-select v-model="status" placeholder="状态" clearable size="small" style="width: 120px" @change="reload">
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
        <el-pagination layout="prev, pager, next, jumper, total" :total="total"
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
import { getNodeList, getMessageList, reconnectControl } from '../api/worker.js'

export default {
  name: 'Control',
  setup() {
    const nodes = ref([])
    const messages = ref([])
    const liveConnected = ref(null)
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
      // 节点数组与分页消息分别来自 /api/admin，单个失败不遮蔽另一块数据。
      const results = await Promise.allSettled([
        getNodeList(),
        getMessageList({ page: page.value, page_size: pageSize.value,
          direction: direction.value, message_type: messageType.value, status: status.value })
      ])
      if (results[0].status === 'fulfilled') nodes.value = results[0].value
      else ElMessage.error(results[0].reason.message)
      if (results[1].status === 'fulfilled') {
        messages.value = results[1].value.items
        total.value = results[1].value.total
      } else ElMessage.error(results[1].reason.message)
      loading.value = false
    }

    const reconnect = async () => {
      reconnecting.value = true
      try {
        // 缺少真实重连接口时显示明确错误，不把持久化状态更新冒充重连。
        const res = await reconnectControl()
        ElMessage.success(res.message || '已触发重连')
        await load()
      } catch (e) { ElMessage.error(e.message) } finally { reconnecting.value = false }
    }

    const reload = () => { page.value = 1; load() }
    const onPage = (p) => { page.value = p; load() }
    const onAutoRefresh = (on) => {
      if (timer) { clearInterval(timer); timer = null }
      if (on) timer = setInterval(load, 5000)
    }
    const statusType = (s) => ({ success: 'success', failed: 'danger', timeout: 'warning', pending: 'info' }[s] || 'info')
    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')

    onMounted(load)
    onUnmounted(() => { if (timer) clearInterval(timer) })
    return { nodes, messages, liveConnected, loading, reconnecting, autoRefresh,
      direction, messageType, status, page, pageSize, total,
      Refresh, Connection, load, reload, reconnect, onPage, onAutoRefresh, statusType, fmt }
  }
}
</script>

<style scoped>
.mb16 { margin-bottom: 16px; }
.card-head { display: flex; justify-content: space-between; align-items: center; }
.filters { display: flex; gap: 8px; }
</style>