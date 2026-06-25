<template>
  <div class="app-page">
    <h1 class="app-page__title">实体索引</h1>
    <p class="page-desc">从上游 dandanplay 响应中解析出的 anime / bangumi / episode 去重索引，可溯源原始数据并跳转到对应缓存。</p>

    <!-- 类型统计 -->
    <el-row :gutter="12" class="stat-row" v-if="stats">
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-label">实体总数</div>
          <div class="stat-value">{{ stats.total }}</div>
        </el-card>
      </el-col>
      <el-col :span="6" v-for="(cnt, t) in stats.types" :key="t">
        <el-card shadow="never" class="stat-card is-accent">
          <div class="stat-label">{{ t }}</div>
          <div class="stat-value">{{ cnt }}</div>
        </el-card>
      </el-col>
    </el-row>

    <div class="app-toolbar">
      <el-select v-model="type" placeholder="全部类型" clearable style="width: 150px" @change="reload">
        <el-option label="anime" value="anime" />
        <el-option label="bangumi" value="bangumi" />
        <el-option label="episode" value="episode" />
      </el-select>
      <el-input v-model="keyword" placeholder="标题关键词" clearable style="width: 220px" @keyup.enter="reload" />
      <el-button type="primary" :icon="Search" @click="reload">查询</el-button>
    </div>

    <el-card shadow="never">
      <el-table :data="items" size="small" v-loading="loading" empty-text="暂无实体">
        <el-table-column prop="entity_type" label="类型" width="90" />
        <el-table-column prop="entity_id" label="ID" width="110" />
        <el-table-column prop="title" label="标题" show-overflow-tooltip min-width="160">
          <template #default="{ row }">{{ row.title || '—' }}</template>
        </el-table-column>
        <el-table-column prop="episode_title" label="分集标题" show-overflow-tooltip min-width="130">
          <template #default="{ row }">{{ row.episode_title || '—' }}</template>
        </el-table-column>
        <el-table-column prop="api_path" label="来源接口" show-overflow-tooltip min-width="160">
          <template #default="{ row }"><span class="app-mono">{{ row.api_path }}</span></template>
        </el-table-column>
        <el-table-column label="最近出现" width="160">
          <template #default="{ row }">{{ fmt(row.last_seen_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="viewDetail(row.id)">详情</el-button>
            <el-button link type="primary" size="small" @click="gotoCache(row.cache_key)">查缓存</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="app-pager">
        <el-pagination layout="prev, pager, next, jumper, total" :total="total"
                       :page-size="pageSize" :current-page="page" @current-change="onPage" />
      </div>
    </el-card>

    <!-- 实体详情抽屉（含 raw_json 溯源） -->
    <el-drawer v-model="drawerVisible" title="实体详情" size="50%">
      <template v-if="detail">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="类型 / ID">{{ detail.entity_type }} / {{ detail.entity_id }}</el-descriptions-item>
          <el-descriptions-item label="标题">{{ detail.title || '—' }}</el-descriptions-item>
          <el-descriptions-item label="分集标题">{{ detail.episode_title || '—' }}</el-descriptions-item>
          <el-descriptions-item label="来源接口"><span class="app-mono">{{ detail.api_path }}</span></el-descriptions-item>
          <el-descriptions-item label="cache_key"><span class="app-mono">{{ detail.cache_key }}</span></el-descriptions-item>
          <el-descriptions-item label="首次 / 最近">{{ fmt(detail.first_seen_at) }} / {{ fmt(detail.last_seen_at) }}</el-descriptions-item>
        </el-descriptions>
        <div class="raw-head">
          <span>上游原始 JSON</span>
          <el-button link type="primary" size="small" @click="gotoCache(detail.cache_key)">跳转对应缓存</el-button>
        </div>
        <pre class="json-body">{{ prettyRaw }}</pre>
      </template>
    </el-drawer>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'Entities',
  setup() {
    const router = useRouter()
    const items = ref([])
    const total = ref(0)
    const page = ref(1)
    const pageSize = ref(20)
    const type = ref('')
    const keyword = ref('')
    const stats = ref(null)
    const loading = ref(false)
    const drawerVisible = ref(false)
    const detail = ref(null)

    const loadStats = async () => {
      try { const res = await apiV2('/entities/stats'); stats.value = res.data }
      catch (e) { /* 统计失败不阻塞列表 */ }
    }
    const load = async () => {
      loading.value = true
      try {
        const q = new URLSearchParams({ page: page.value, page_size: pageSize.value })
        if (type.value) q.set('type', type.value)
        if (keyword.value) q.set('keyword', keyword.value)
        const res = await apiV2(`/entities?${q.toString()}`)
        items.value = res.items || []
        total.value = res.total || 0
      } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
    }
    const reload = () => { page.value = 1; load(); loadStats() }
    const onPage = (p) => { page.value = p; load() }

    const viewDetail = async (id) => {
      try { const res = await apiV2(`/entities/${id}`); detail.value = res.data; drawerVisible.value = true }
      catch (e) { ElMessage.error(e.message) }
    }
    // 携带 cache_key 跳转响应缓存页并自动过滤
    const gotoCache = (key) => { router.push({ path: '/cache', query: { cache_key: key } }) }

    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')
    const prettyRaw = computed(() => {
      if (!detail.value || !detail.value.raw_json) return '（无）'
      try { return JSON.stringify(detail.value.raw_json, null, 2) }
      catch { return String(detail.value.raw_json) }
    })

    onMounted(() => { load(); loadStats() })
    return { items, total, page, pageSize, type, keyword, stats, loading,
      drawerVisible, detail, Search, reload, onPage, viewDetail, gotoCache, fmt, prettyRaw }
  }
}
</script>

<style scoped>
.page-desc { color: #909399; font-size: 13px; margin-bottom: 16px; }
.stat-row { margin-bottom: 16px; }
.stat-card { border-radius: 10px; }
.stat-card.is-accent { background: #ecf5ff; }
.stat-label { font-size: 13px; color: #909399; }
.stat-value { font-size: 26px; font-weight: 600; color: #303133; margin-top: 4px; }
.raw-head { display: flex; justify-content: space-between; align-items: center; margin: 16px 0 8px; font-size: 13px; color: #606266; }
.json-body { background: #1e1e1e; color: #d4d4d4; padding: 14px;
  border-radius: 8px; font-size: 12px; max-height: 50vh; overflow: auto; white-space: pre-wrap; }
</style>