<template>
  <div class="page">
    <h1 class="page-title">IP 请求统计</h1>
    <div class="toolbar">
      <input v-model="keyword" class="input" placeholder="搜索 IP" @keyup.enter="load" />
      <select v-model="orderBy" class="input" @change="load">
        <option value="total_count">按请求量</option>
        <option value="violation_count">按违规数</option>
      </select>
      <button class="btn btn-primary" @click="load">查询</button>
    </div>

    <div v-if="msg" class="tip">{{ msg }}</div>

    <div class="panel">
      <table class="data-table">
        <thead><tr>
          <th>IP</th><th>Worker</th><th>请求量</th><th>违规数</th>
          <th>最近访问</th><th>Top 路径</th>
        </tr></thead>
        <tbody>
          <tr v-for="r in items" :key="r.id">
            <td class="key">{{ r.ip }}</td>
            <td>{{ r.worker_id }}</td>
            <td>{{ r.total_count }}</td>
            <td :class="{ warn: r.violation_count > 0 }">{{ r.violation_count }}</td>
            <td>{{ fmt(r.last_access_at) }}</td>
            <td class="paths">{{ topPaths(r.path_stats) }}</td>
          </tr>
          <tr v-if="!items.length"><td colspan="6" class="empty">暂无统计</td></tr>
        </tbody>
      </table>
      <Pager :page="page" :page-size="pageSize" :total="total" @update:page="goPage" />
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import { apiV2 } from '../utils/api.js'
import Pager from '../components/Pager.vue'

export default {
  name: 'IpStats',
  components: { Pager },
  setup() {
    const items = ref([])
    const total = ref(0)
    const page = ref(1)
    const pageSize = ref(50)
    const keyword = ref('')
    const orderBy = ref('total_count')
    const msg = ref('')

    const load = async () => {
      msg.value = ''
      try {
        const q = new URLSearchParams({ page: page.value, page_size: pageSize.value, order_by: orderBy.value })
        if (keyword.value) q.set('keyword', keyword.value)
        const res = await apiV2(`/ip-stats/current?${q.toString()}`)
        items.value = res.items || []
        total.value = res.total || 0
      } catch (e) { msg.value = e.message }
    }

    const goPage = (p) => { page.value = p; load() }
    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')
    const topPaths = (paths) => {
      if (!paths || typeof paths !== 'object') return '—'
      const entries = Object.entries(paths).sort((a, b) => b[1] - a[1]).slice(0, 3)
      return entries.length ? entries.map(([k, v]) => `${k}:${v}`).join(', ') : '—'
    }

    onMounted(load)
    return { items, total, page, pageSize, keyword, orderBy, msg, load, goPage, fmt, topPaths }
  }
}
</script>

<style scoped>
.page { padding: 24px; }
.page-title { font-size: 22px; margin-bottom: 20px; color: #333; }
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; }
.input { padding: 8px 12px; border: 1px solid #d9d9d9; border-radius: 6px; }
.btn { padding: 8px 16px; border: 1px solid #d9d9d9; background: #fff; border-radius: 6px; cursor: pointer; }
.btn:disabled { opacity: .6; cursor: not-allowed; }
.btn-primary { background: #1677ff; color: #fff; border-color: #1677ff; }
.tip { background: #e6f4ff; border: 1px solid #91caff; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; color: #0958d9; }
.panel { background: #fff; border-radius: 10px; padding: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
.data-table th { color: #888; font-weight: 500; }
.key { font-family: monospace; font-size: 12px; }
.warn { color: #cf1322; font-weight: 600; }
.paths { color: #666; font-size: 12px; max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
.empty { text-align: center; color: #999; padding: 20px; }
.pager { display: flex; gap: 12px; align-items: center; margin-top: 14px; justify-content: flex-end; }
</style>
