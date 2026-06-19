<template>
  <div class="page">
    <h1 class="page-title">响应缓存</h1>
    <div class="toolbar">
      <input v-model="keyword" class="input" placeholder="搜索 cache_key" @keyup.enter="load" />
      <input v-model="apiPath" class="input" placeholder="api_path 过滤" @keyup.enter="load" />
      <button class="btn btn-primary" @click="load">查询</button>
    </div>

    <div v-if="msg" class="tip">{{ msg }}</div>

    <div class="panel">
      <table class="data-table">
        <thead><tr>
          <th>api_path</th><th>状态</th><th>大小</th><th>存储</th>
          <th>命中</th><th>兜底</th><th>待刷新</th><th>获取时间</th><th>操作</th>
        </tr></thead>
        <tbody>
          <tr v-for="r in items" :key="r.id">
            <td class="key">{{ r.api_path }}</td>
            <td>{{ r.status_code }}</td>
            <td>{{ fmtSize(r.body_size) }}</td>
            <td>{{ r.storage_mode }}</td>
            <td>{{ r.hit_count }}</td>
            <td>{{ r.stale_hit_count }}</td>
            <td>{{ r.refresh_pending ? '是' : '—' }}</td>
            <td>{{ fmt(r.fetched_at) }}</td>
            <td class="actions">
              <button class="link" @click="viewDetail(r.id)">详情</button>
              <button class="link" @click="markRefresh(r.id)">标记刷新</button>
              <button class="link danger" @click="del(r.id)">删除</button>
            </td>
          </tr>
          <tr v-if="!items.length"><td colspan="9" class="empty">暂无缓存</td></tr>
        </tbody>
      </table>
      <div class="pager">
        <button class="btn" :disabled="page<=1" @click="prev">上一页</button>
        <span>第 {{ page }} 页 / 共 {{ total }} 条</span>
        <button class="btn" :disabled="page*pageSize>=total" @click="next">下一页</button>
      </div>
    </div>

    <!-- 详情抽屉 -->
    <div v-if="detail" class="drawer-mask" @click.self="detail=null">
      <div class="drawer">
        <div class="drawer-head">
          <h2>缓存详情</h2>
          <button class="close" @click="detail=null">×</button>
        </div>
        <div class="drawer-body">
          <p class="kv"><b>cache_key:</b> <code>{{ detail.cache_key }}</code></p>
          <p class="kv"><b>api_path:</b> {{ detail.api_path }}</p>
          <p class="kv"><b>状态:</b> {{ detail.status_code }} / 存储 {{ detail.storage_mode }}</p>
          <p class="kv"><b>响应体:</b></p>
          <pre class="json">{{ prettyBody }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
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
    const msg = ref('')
    const detail = ref(null)

    const load = async () => {
      msg.value = ''
      try {
        const q = new URLSearchParams({ page: page.value, page_size: pageSize.value })
        if (keyword.value) q.set('keyword', keyword.value)
        if (apiPath.value) q.set('api_path', apiPath.value)
        const res = await apiV2(`/cache/responses?${q.toString()}`)
        items.value = res.items || []
        total.value = res.total || 0
      } catch (e) { msg.value = e.message }
    }

    const viewDetail = async (id) => {
      try {
        const res = await apiV2(`/cache/responses/${id}`)
        detail.value = res.data
      } catch (e) { msg.value = e.message }
    }

    const markRefresh = async (id) => {
      try { await apiV2(`/cache/responses/${id}/mark-refresh`, { method: 'POST' }); load() }
      catch (e) { msg.value = e.message }
    }

    const del = async (id) => {
      if (!confirm('确认删除该缓存？')) return
      try { await apiV2(`/cache/responses/${id}`, { method: 'DELETE' }); load() }
      catch (e) { msg.value = e.message }
    }

    const prev = () => { if (page.value > 1) { page.value--; load() } }
    const next = () => { if (page.value * pageSize.value < total.value) { page.value++; load() } }
    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')
    const fmtSize = (n) => (n > 1024 ? (n / 1024).toFixed(1) + 'KB' : n + 'B')
    const prettyBody = computed(() => {
      if (!detail.value || !detail.value.body) return '（无）'
      try { return JSON.stringify(JSON.parse(detail.value.body), null, 2) }
      catch { return detail.value.body }
    })

    onMounted(load)
    return { items, total, page, pageSize, keyword, apiPath, msg, detail,
      load, viewDetail, markRefresh, del, prev, next, fmt, fmtSize, prettyBody }
  }
}
</script>

<style scoped>
.page { padding: 24px; }
.page-title { font-size: 22px; margin-bottom: 20px; color: #333; }
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; }
.input { padding: 8px 12px; border: 1px solid #d9d9d9; border-radius: 6px; min-width: 200px; }
.btn { padding: 8px 16px; border: 1px solid #d9d9d9; background: #fff; border-radius: 6px; cursor: pointer; }
.btn-primary { background: #1677ff; color: #fff; border-color: #1677ff; }
.tip { background: #fff1f0; border: 1px solid #ffccc7; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; color: #cf1322; }
.panel { background: #fff; border-radius: 10px; padding: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
.data-table th { color: #888; font-weight: 500; }
.key { font-family: monospace; font-size: 12px; max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
.actions { display: flex; gap: 8px; }
.link { background: none; border: none; color: #1677ff; cursor: pointer; font-size: 13px; }
.link.danger { color: #cf1322; }
.empty { text-align: center; color: #999; padding: 20px; }
.pager { display: flex; align-items: center; gap: 12px; justify-content: center; margin-top: 16px; color: #888; font-size: 13px; }
.drawer-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; justify-content: flex-end; z-index: 100; }
.drawer { width: 560px; max-width: 90vw; background: #fff; height: 100%; display: flex; flex-direction: column; }
.drawer-head { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid #f0f0f0; }
.close { background: none; border: none; font-size: 24px; cursor: pointer; color: #999; }
.drawer-body { padding: 20px; overflow: auto; }
.kv { margin-bottom: 10px; font-size: 13px; color: #555; }
.json { background: #f6f8fa; padding: 14px; border-radius: 6px; font-size: 12px; overflow: auto; max-height: 60vh; white-space: pre-wrap; word-break: break-all; }
</style>