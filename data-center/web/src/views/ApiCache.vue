<template>
  <div class="app-page">
    <h1 class="app-page__title">响应缓存</h1>

    <div class="app-toolbar">
      <el-input v-model="keyword" placeholder="搜索 cache_key" clearable style="width: 200px" @keyup.enter="reload" />
      <el-input v-model="apiPath" placeholder="api_path 过滤" clearable style="width: 200px" @keyup.enter="reload" />
      <el-input v-model="clientIp" placeholder="客户端 IP 过滤" clearable style="width: 200px" @keyup.enter="reload" />
      <el-button type="primary" :icon="Search" @click="reload">查询</el-button>
    </div>

    <el-card shadow="never">
      <el-table :data="items" size="small" v-loading="loading" empty-text="暂无缓存">
        <el-table-column prop="api_path" label="api_path" show-overflow-tooltip />
        <el-table-column prop="status_code" label="状态" width="80" />
        <el-table-column label="客户端IP" width="150">
          <template #default="{ row }">
            <span class="app-mono">{{ row.client_ip || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="大小" width="90">
          <template #default="{ row }">{{ fmtSize(row.body_size) }}</template>
        </el-table-column>
        <el-table-column prop="storage_mode" label="存储" width="80" />
        <el-table-column prop="hit_count" label="命中" width="70" />
        <el-table-column prop="stale_hit_count" label="兜底" width="70" />
        <el-table-column label="待刷新" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.refresh_pending" type="warning" size="small">是</el-tag>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="获取时间" width="170">
          <template #default="{ row }">{{ fmt(row.fetched_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="viewDetail(row.id)">详情</el-button>
            <el-button link type="primary" size="small" @click="markRefresh(row.id)">标记刷新</el-button>
            <el-button link type="danger" size="small" @click="del(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="app-pager">
        <el-pagination layout="prev, pager, next, jumper, total" :total="total"
                       :page-size="pageSize" :current-page="page" @current-change="onPage" />
      </div>
    </el-card>

    <el-drawer v-model="drawerVisible" title="缓存详情" size="50%">
      <template v-if="detail">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="cache_key"><span class="app-mono">{{ detail.cache_key }}</span></el-descriptions-item>
          <el-descriptions-item label="api_path">{{ detail.api_path }}</el-descriptions-item>
          <el-descriptions-item label="客户端IP"><span class="app-mono">{{ detail.client_ip || '—' }}</span></el-descriptions-item>
          <el-descriptions-item label="状态">{{ detail.status_code }} / 存储 {{ detail.storage_mode }}</el-descriptions-item>
        </el-descriptions>
        <pre class="json-body">{{ prettyBody }}</pre>
      </template>
    </el-drawer>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'ApiCache',
  setup() {
    const items = ref([])
    const total = ref(0)
    const page = ref(1)
    const pageSize = ref(20)
    const keyword = ref('')
    const apiPath = ref('')
    const clientIp = ref('')
    const loading = ref(false)
    const drawerVisible = ref(false)
    const detail = ref(null)

    const load = async () => {
      loading.value = true
      try {
        const q = new URLSearchParams({ page: page.value, page_size: pageSize.value })
        if (keyword.value) q.set('keyword', keyword.value)
        if (apiPath.value) q.set('api_path', apiPath.value)
        if (clientIp.value) q.set('client_ip', clientIp.value)
        const res = await apiV2(`/cache/responses?${q.toString()}`)
        items.value = res.items || []
        total.value = res.total || 0
      } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
    }
    const reload = () => { page.value = 1; load() }
    const onPage = (p) => { page.value = p; load() }

    const viewDetail = async (id) => {
      try {
        const res = await apiV2(`/cache/responses/${id}`)
        detail.value = res.data
        drawerVisible.value = true
      } catch (e) { ElMessage.error(e.message) }
    }
    const markRefresh = async (id) => {
      try { await apiV2(`/cache/responses/${id}/mark-refresh`, { method: 'POST' }); ElMessage.success('已标记刷新'); load() }
      catch (e) { ElMessage.error(e.message) }
    }
    const del = async (id) => {
      try {
        await ElMessageBox.confirm('确认删除该缓存？', '提示', { type: 'warning' })
        await apiV2(`/cache/responses/${id}`, { method: 'DELETE' })
        ElMessage.success('已删除'); load()
      } catch (e) { if (e !== 'cancel') ElMessage.error(e.message || '操作失败') }
    }

    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')
    const fmtSize = (n) => (n > 1024 ? (n / 1024).toFixed(1) + 'KB' : (n || 0) + 'B')
    const prettyBody = computed(() => {
      if (!detail.value || !detail.value.body) return '（无）'
      try { return JSON.stringify(JSON.parse(detail.value.body), null, 2) }
      catch { return detail.value.body }
    })

    onMounted(load)
    return { items, total, page, pageSize, keyword, apiPath, clientIp, loading,
      drawerVisible, detail, Search, reload, onPage, viewDetail, markRefresh, del,
      fmt, fmtSize, prettyBody }
  }
}
</script>

<style scoped>
.json-body { margin-top: 16px; background: #1e1e1e; color: #d4d4d4; padding: 14px;
  border-radius: 8px; font-size: 12px; max-height: 50vh; overflow: auto; white-space: pre-wrap; }
</style>