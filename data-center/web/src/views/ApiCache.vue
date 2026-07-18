<template>
  <div class="app-page">
    <h1 class="app-page__title">响应缓存</h1>

    <!-- 统计概览 -->
    <el-row :gutter="12" class="stat-row" v-if="stats">
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-label">缓存总数</div>
          <div class="stat-value">{{ stats.total }}</div>
          <div class="stat-sub">已过期 {{ stats.expired }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card" :class="stats.refresh_pending > 0 ? 'is-warn' : ''">
          <div class="stat-label">待刷新</div>
          <div class="stat-value">{{ stats.refresh_pending }}</div>
          <div class="stat-sub">等下次 200 刷新</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-label">存储分布</div>
          <div class="stat-value">{{ stats.redis_count }}<span class="stat-unit"> redis</span></div>
          <div class="stat-sub">SQL 冷备 {{ stats.sql_count }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-label">总体积</div>
          <div class="stat-value">{{ fmtSize(stats.total_bytes) }}</div>
          <div class="stat-sub">响应体合计</div>
        </el-card>
      </el-col>
    </el-row>

    <div class="app-toolbar">
      <el-input v-model="keyword" placeholder="搜索 cache_key" clearable style="width: 200px" @keyup.enter="reload" />
      <el-input v-model="apiPath" placeholder="api_path 过滤" clearable style="width: 200px" @keyup.enter="reload" />
      <el-input v-model="clientIp" placeholder="客户端 IP 过滤" clearable style="width: 180px" @keyup.enter="reload" />
      <el-checkbox v-model="onlyPending" label="仅待刷新" border @change="reload" />
      <el-button type="primary" :icon="Search" @click="reload">查询</el-button>
    </div>

    <el-card shadow="never">
      <el-table :data="items" size="small" v-loading="loading" empty-text="暂无缓存">
        <el-table-column prop="api_path" label="api_path" show-overflow-tooltip />
        <el-table-column prop="method" label="方法" width="70" />
        <el-table-column prop="status_code" label="状态" width="70" />
        <el-table-column label="客户端IP" width="140">
          <template #default="{ row }">
            <span class="app-mono">{{ row.client_ip || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="大小" width="80">
          <template #default="{ row }">{{ fmtSize(row.body_size) }}</template>
        </el-table-column>
        <el-table-column prop="storage_mode" label="存储" width="70" />
        <el-table-column prop="hit_count" label="命中" width="60" />
        <el-table-column label="429兜底" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.upstream_429_count > 0" type="danger" size="small">{{ row.upstream_429_count }}</el-tag>
            <span v-else>{{ row.stale_hit_count || 0 }}</span>
          </template>
        </el-table-column>
        <el-table-column label="过期时间" width="160">
          <template #default="{ row }">
            <span :class="isExpired(row.expire_at) ? 'expired' : ''">{{ fmt(row.expire_at) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="待刷新" width="76">
          <template #default="{ row }">
            <el-tag v-if="row.refresh_pending" type="warning" size="small">是</el-tag>
            <span v-else>—</span>
          </template>
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
          <el-descriptions-item label="api_path">{{ detail.method }} {{ detail.api_path }}</el-descriptions-item>
          <el-descriptions-item label="客户端IP"><span class="app-mono">{{ detail.client_ip || '—' }}</span></el-descriptions-item>
          <el-descriptions-item label="状态">{{ detail.status_code }} / 存储 {{ detail.storage_mode }}</el-descriptions-item>
          <el-descriptions-item label="命中 / 兜底 / 429">{{ detail.hit_count }} / {{ detail.stale_hit_count }} / {{ detail.upstream_429_count }}</el-descriptions-item>
          <el-descriptions-item label="获取时间">{{ fmt(detail.fetched_at) }}</el-descriptions-item>
          <el-descriptions-item label="刷新时间">{{ fmt(detail.refresh_after) }}</el-descriptions-item>
          <el-descriptions-item label="过期时间">{{ fmt(detail.expire_at) }}</el-descriptions-item>
        </el-descriptions>
        <pre class="json-body">{{ prettyBody }}</pre>
      </template>
    </el-drawer>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'ApiCache',
  setup() {
    const route = useRoute()
    const items = ref([])
    const total = ref(0)
    const page = ref(1)
    const pageSize = ref(20)
    const keyword = ref('')
    const apiPath = ref('')
    const clientIp = ref('')
    const onlyPending = ref(false)
    const stats = ref(null)
    const loading = ref(false)
    const drawerVisible = ref(false)
    const detail = ref(null)

    const loadStats = async () => {
      try { const res = await apiV2('/cache/stats'); stats.value = res.data }
      catch (e) { /* 统计失败不阻塞列表 */ }
    }

    const load = async () => {
      loading.value = true
      try {
        const q = new URLSearchParams({ page: page.value, page_size: pageSize.value })
        if (keyword.value) q.set('keyword', keyword.value)
        if (apiPath.value) q.set('api_path', apiPath.value)
        if (clientIp.value) q.set('client_ip', clientIp.value)
        if (onlyPending.value) q.set('refresh_pending', 'true')
        const res = await apiV2(`/cache/responses?${q.toString()}`)
        items.value = res.items || []
        total.value = res.total || 0
      } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
    }
    const reload = () => { page.value = 1; load(); loadStats() }
    const onPage = (p) => { page.value = p; load() }

    const viewDetail = async (id) => {
      try {
        const res = await apiV2(`/cache/responses/${id}`)
        detail.value = res.data
        drawerVisible.value = true
      } catch (e) { ElMessage.error(e.message) }
    }
    const markRefresh = async (id) => {
      try { await apiV2(`/cache/responses/${id}/mark-refresh`, { method: 'POST' }); ElMessage.success('已标记刷新'); load(); loadStats() }
      catch (e) { ElMessage.error(e.message) }
    }
    const del = async (id) => {
      try {
        await ElMessageBox.confirm('确认删除该缓存？', '提示', { type: 'warning' })
        await apiV2(`/cache/responses/${id}`, { method: 'DELETE' })
        ElMessage.success('已删除'); load(); loadStats()
      } catch (e) { if (e !== 'cancel') ElMessage.error(e.message || '操作失败') }
    }

    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')
    const fmtSize = (n) => (n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + 'MB' : n > 1024 ? (n / 1024).toFixed(1) + 'KB' : (n || 0) + 'B')
    // 判断缓存是否已过期（过期时间早于当前）
    const isExpired = (s) => (s ? new Date(s).getTime() < Date.now() : false)
    const prettyBody = computed(() => {
      if (!detail.value || !detail.value.body) return '（无）'
      try { return JSON.stringify(JSON.parse(detail.value.body), null, 2) }
      catch { return detail.value.body }
    })

    onMounted(() => {
      // 支持从实体索引等页面带 cache_key 跳转过来自动过滤
      if (route.query.cache_key) keyword.value = route.query.cache_key
      load(); loadStats()
    })
    return { items, total, page, pageSize, keyword, apiPath, clientIp, onlyPending, stats, loading,
      drawerVisible, detail, Search, reload, onPage, viewDetail, markRefresh, del,
      fmt, fmtSize, isExpired, prettyBody }
  }
}
</script>

<style scoped>
.stat-row { margin-bottom: 16px; }
.stat-card { border-radius: 10px; }
.stat-card.is-warn { background: #fffbe6; }
.stat-label { font-size: 13px; color: #909399; }
.stat-value { font-size: 26px; font-weight: 600; color: #303133; margin-top: 4px; }
.stat-unit { font-size: 13px; font-weight: 400; color: #909399; }
.stat-sub { font-size: 12px; color: #c0c4cc; margin-top: 2px; }
.expired { color: #f56c6c; }
.json-body { margin-top: 16px; background: #1e1e1e; color: #d4d4d4; padding: 14px;
  border-radius: 8px; font-size: 12px; max-height: 50vh; overflow: auto; white-space: pre-wrap; }
</style>