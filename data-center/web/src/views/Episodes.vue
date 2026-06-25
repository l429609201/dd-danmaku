<template>
  <div class="page">
    <h1 class="page-title">集数链接</h1>
    <div class="toolbar">
      <input v-model="keyword" class="input" placeholder="标题关键词" @keyup.enter="load" />
      <input v-model="episodeId" class="input" placeholder="episodeId" @keyup.enter="load" />
      <button class="btn btn-primary" @click="load">查询</button>
    </div>

    <div v-if="msg" class="tip">{{ msg }}</div>

    <div class="panel">
      <table class="data-table">
        <thead><tr>
          <th>标题</th><th>季</th><th>集</th><th>episodeId</th>
          <th>动画</th><th>来源</th><th>置信度</th><th>人工</th><th>操作</th>
        </tr></thead>
        <tbody>
          <tr v-for="r in items" :key="r.id">
            <td>{{ r.local_title }}</td>
            <td>{{ r.season_number ?? '—' }}</td>
            <td>{{ r.episode_number || '—' }}</td>
            <td>{{ r.dandan_episode_id }}</td>
            <td>{{ r.anime_title || '—' }}</td>
            <td>{{ r.match_source }}</td>
            <td>{{ r.confidence }}</td>
            <td>{{ r.is_manual ? '是' : '—' }}</td>
            <td><button class="link" @click="openFix(r)">修正</button></td>
          </tr>
          <tr v-if="!items.length"><td colspan="9" class="empty">暂无集数链接</td></tr>
        </tbody>
      </table>
      <Pager :page="page" :page-size="pageSize" :total="total" @update:page="goPage" />
    </div>

    <!-- 修正弹窗 -->
    <div v-if="editing" class="drawer-mask" @click.self="editing=null">
      <div class="modal">
        <h2>人工修正集数链接</h2>
        <p class="kv">标题：{{ editing.local_title }}</p>
        <label class="field">episodeId
          <input v-model="form.dandan_episode_id" class="input" />
        </label>
        <label class="field">分集标题
          <input v-model="form.episode_title" class="input" />
        </label>
        <label class="field">置信度
          <input v-model.number="form.confidence" type="number" class="input" />
        </label>
        <div class="modal-actions">
          <button class="btn" @click="editing=null">取消</button>
          <button class="btn btn-primary" @click="saveFix">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import { apiV2 } from '../utils/api.js'
import Pager from '../components/Pager.vue'

export default {
  name: 'Episodes',
  components: { Pager },
  setup() {
    const items = ref([])
    const total = ref(0)
    const page = ref(1)
    const pageSize = ref(20)
    const keyword = ref('')
    const episodeId = ref('')
    const msg = ref('')
    const editing = ref(null)
    const form = ref({})

    const load = async () => {
      msg.value = ''
      try {
        const q = new URLSearchParams({ page: page.value, page_size: pageSize.value })
        if (keyword.value) q.set('keyword', keyword.value)
        if (episodeId.value) q.set('episode_id', episodeId.value)
        const res = await apiV2(`/episodes/links?${q.toString()}`)
        items.value = res.items || []
        total.value = res.total || 0
      } catch (e) { msg.value = e.message }
    }

    const openFix = (r) => {
      editing.value = r
      form.value = {
        dandan_episode_id: r.dandan_episode_id,
        episode_title: r.episode_title || '',
        confidence: r.confidence,
      }
    }

    const saveFix = async () => {
      try {
        await apiV2(`/episodes/links/${editing.value.id}`, { method: 'PUT', body: form.value })
        editing.value = null
        load()
      } catch (e) { msg.value = e.message }
    }

    const goPage = (p) => { page.value = p; load() }

    onMounted(load)
    return { items, total, page, pageSize, keyword, episodeId, msg, editing, form,
      load, openFix, saveFix, goPage }
  }
}
</script>

<style scoped>
.page { padding: 24px; }
.page-title { font-size: 22px; margin-bottom: 20px; color: #333; }
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; }
.input { padding: 8px 12px; border: 1px solid #d9d9d9; border-radius: 6px; min-width: 180px; }
.btn { padding: 8px 16px; border: 1px solid #d9d9d9; background: #fff; border-radius: 6px; cursor: pointer; }
.btn-primary { background: #1677ff; color: #fff; border-color: #1677ff; }
.tip { background: #fff1f0; border: 1px solid #ffccc7; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; color: #cf1322; }
.panel { background: #fff; border-radius: 10px; padding: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
.data-table th { color: #888; font-weight: 500; }
.link { background: none; border: none; color: #1677ff; cursor: pointer; font-size: 13px; }
.empty { text-align: center; color: #999; padding: 20px; }
.pager { display: flex; align-items: center; gap: 12px; justify-content: center; margin-top: 16px; color: #888; font-size: 13px; }
.drawer-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: #fff; border-radius: 10px; padding: 24px; width: 420px; max-width: 90vw; }
.modal h2 { font-size: 18px; margin-bottom: 16px; }
.field { display: block; margin-bottom: 14px; font-size: 13px; color: #555; }
.field .input { display: block; width: 100%; margin-top: 6px; box-sizing: border-box; }
.kv { margin-bottom: 14px; font-size: 13px; color: #555; }
.modal-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 8px; }
</style>