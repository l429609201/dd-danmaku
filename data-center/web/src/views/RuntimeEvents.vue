<template>
  <div class="page">
    <h1 class="page-title">运行日志</h1>
    <div class="toolbar">
      <select v-model="level" class="input" @change="reload">
        <option value="">全部级别</option>
        <option value="INFO">INFO</option>
        <option value="WARN">WARN</option>
        <option value="ERROR">ERROR</option>
      </select>
      <input v-model="category" class="input" placeholder="分类 (control/cache/...)" @keyup.enter="reload" />
      <button class="btn btn-primary" @click="reload">查询</button>
    </div>

    <div v-if="msg" class="tip">{{ msg }}</div>

    <div class="panel">
      <table class="data-table">
        <thead><tr><th>级别</th><th>分类</th><th>事件</th><th>消息</th><th>时间</th></tr></thead>
        <tbody>
          <tr v-for="e in items" :key="e.id">
            <td><span :class="'lv lv-' + e.level.toLowerCase()">{{ e.level }}</span></td>
            <td>{{ e.category }}</td>
            <td>{{ e.event }}</td>
            <td class="msg">{{ e.message }}</td>
            <td>{{ fmt(e.created_at) }}</td>
          </tr>
          <tr v-if="!items.length"><td colspan="5" class="empty">暂无日志</td></tr>
        </tbody>
      </table>
      <Pager :page="page" :page-size="pageSize" :total="total" @update:page="goPage" />
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import { getEventList } from '../api/worker.js'
import Pager from '../components/Pager.vue'

export default {
  name: 'RuntimeEvents',
  components: { Pager },
  setup() {
    const items = ref([])
    const total = ref(0)
    const page = ref(1)
    const pageSize = ref(50)
    const level = ref('')
    const category = ref('')
    const msg = ref('')

    const load = async () => {
      msg.value = ''
      try {
        // Rust admin 事件接口使用 snake_case 分页，响应无 data 包裹。
        const res = await getEventList({ page: page.value, page_size: pageSize.value,
          level: level.value, category: category.value })
        items.value = res.items
        total.value = res.total
      } catch (e) { msg.value = e.message }
    }

    const reload = () => { page.value = 1; load() }
    const goPage = (p) => { page.value = p; load() }
    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')

    onMounted(load)
    return { items, total, page, pageSize, level, category, msg, reload, goPage, fmt }
  }
}
</script>

<style scoped>
.page { padding: 24px; }
.page-title { font-size: 22px; margin-bottom: 20px; color: var(--color-text); }
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; }
.input { padding: 8px 12px; border: 1px solid var(--color-border); border-radius: 6px; min-width: 160px; background: var(--color-bg); color: var(--color-text); }
.btn { padding: 8px 16px; border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text); border-radius: 6px; cursor: pointer; }
.btn-primary { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.tip { background: color-mix(in srgb, var(--color-danger) 8%, transparent); border: 1px solid color-mix(in srgb, var(--color-danger) 25%, transparent); padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; color: var(--color-danger); }
.panel { background: var(--color-bg); border-radius: 10px; padding: 18px; box-shadow: var(--shadow-sm); border: 1px solid var(--color-border-light); }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--color-border-lighter); font-size: 13px; }
.data-table th { color: var(--color-text-secondary); font-weight: 500; }
.lv { padding: 2px 8px; border-radius: 4px; font-size: 12px; }
.lv-info { background: color-mix(in srgb, var(--color-primary) 10%, transparent); color: var(--color-primary); }
.lv-warn { background: color-mix(in srgb, var(--color-warning) 10%, transparent); color: var(--color-warning); }
.lv-error { background: color-mix(in srgb, var(--color-danger) 10%, transparent); color: var(--color-danger); }
.msg { max-width: 360px; overflow: hidden; text-overflow: ellipsis; }
.empty { text-align: center; color: var(--color-text-disabled); padding: 20px; }
.pager { display: flex; align-items: center; gap: 12px; justify-content: center; margin-top: 16px; color: var(--color-text-secondary); font-size: 13px; }
</style>