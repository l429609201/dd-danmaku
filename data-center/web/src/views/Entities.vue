<template>
  <div class="page">
    <h1 class="page-title">实体索引</h1>
    <div class="toolbar">
      <select v-model="type" class="input" @change="load">
        <option value="">全部类型</option>
        <option value="anime">anime</option>
        <option value="bangumi">bangumi</option>
        <option value="episode">episode</option>
      </select>
      <input v-model="keyword" class="input" placeholder="标题关键词" @keyup.enter="load" />
      <button class="btn btn-primary" @click="load">查询</button>
    </div>

    <div v-if="msg" class="tip">{{ msg }}</div>

    <div class="panel">
      <table class="data-table">
        <thead><tr><th>类型</th><th>ID</th><th>标题</th><th>分集标题</th><th>来源接口</th><th>最近出现</th></tr></thead>
        <tbody>
          <tr v-for="r in items" :key="r.id">
            <td>{{ r.entity_type }}</td>
            <td>{{ r.entity_id }}</td>
            <td>{{ r.title || '—' }}</td>
            <td>{{ r.episode_title || '—' }}</td>
            <td class="key">{{ r.api_path }}</td>
            <td>{{ fmt(r.last_seen_at) }}</td>
          </tr>
          <tr v-if="!items.length"><td colspan="6" class="empty">暂无实体</td></tr>
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
  name: 'Entities',
  components: { Pager },
  setup() {
    const items = ref([])
    const total = ref(0)
    const page = ref(1)
    const pageSize = ref(20)
    const type = ref('')
    const keyword = ref('')
    const msg = ref('')

    const load = async () => {
      msg.value = ''
      try {
        const q = new URLSearchParams({ page: page.value, page_size: pageSize.value })
        if (type.value) q.set('type', type.value)
        if (keyword.value) q.set('keyword', keyword.value)
        const res = await apiV2(`/entities?${q.toString()}`)
        items.value = res.items || []
        total.value = res.total || 0
      } catch (e) { msg.value = e.message }
    }

    const goPage = (p) => { page.value = p; load() }
    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')

    onMounted(load)
    return { items, total, page, pageSize, type, keyword, msg, load, goPage, fmt }
  }
}
</script>

<style scoped>
.page { padding: 24px; }
.page-title { font-size: 22px; margin-bottom: 20px; color: #333; }
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; }
.input { padding: 8px 12px; border: 1px solid #d9d9d9; border-radius: 6px; min-width: 160px; }
.btn { padding: 8px 16px; border: 1px solid #d9d9d9; background: #fff; border-radius: 6px; cursor: pointer; }
.btn-primary { background: #1677ff; color: #fff; border-color: #1677ff; }
.tip { background: #fff1f0; border: 1px solid #ffccc7; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; color: #cf1322; }
.panel { background: #fff; border-radius: 10px; padding: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
.data-table th { color: #888; font-weight: 500; }
.key { font-family: monospace; font-size: 12px; }
.empty { text-align: center; color: #999; padding: 20px; }
.pager { display: flex; align-items: center; gap: 12px; justify-content: center; margin-top: 16px; color: #888; font-size: 13px; }
</style>