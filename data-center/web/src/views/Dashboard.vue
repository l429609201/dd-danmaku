<template>
  <div class="page">
    <h1 class="page-title">概览</h1>

    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="error" class="error-box">{{ error }}</div>

    <template v-else>
      <!-- Worker 状态卡片 -->
      <div class="cards">
        <div class="card" :class="data.worker.connected ? 'card-ok' : 'card-warn'">
          <div class="card-label">Worker 连接</div>
          <div class="card-value">{{ data.worker.connected ? '在线' : '离线' }}</div>
          <div class="card-sub">节点: {{ data.worker.node_id || '—' }}</div>
          <div class="card-sub">延迟: {{ data.worker.latency_ms }} ms</div>
        </div>
        <div class="card" @click="goto('/cache')">
          <div class="card-label">缓存总数</div>
          <div class="card-value">{{ data.totals.cache_count }}</div>
        </div>
        <div class="card" @click="goto('/episodes')">
          <div class="card-label">集数链接</div>
          <div class="card-value">{{ data.totals.episode_links }}</div>
        </div>
        <div class="card">
          <div class="card-label">待刷新任务</div>
          <div class="card-value">{{ data.totals.refresh_pending }}</div>
        </div>
        <div class="card">
          <div class="card-label">今日缓存命中</div>
          <div class="card-value">{{ data.today.cache_hits }}</div>
        </div>
        <div class="card">
          <div class="card-label">今日 429 兜底</div>
          <div class="card-value">{{ data.today.fallback_hits }}</div>
        </div>
      </div>

      <!-- 最近错误 -->
      <div class="panel">
        <h2 class="panel-title">最近错误事件</h2>
        <table class="data-table" v-if="data.recent_errors.length">
          <thead><tr><th>事件</th><th>消息</th><th>时间</th></tr></thead>
          <tbody>
            <tr v-for="(e, i) in data.recent_errors" :key="i">
              <td>{{ e.event }}</td>
              <td>{{ e.message }}</td>
              <td>{{ fmt(e.created_at) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty">暂无错误事件</div>
      </div>
    </template>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'Dashboard',
  setup() {
    const router = useRouter()
    const loading = ref(true)
    const error = ref('')
    const data = ref(null)

    const load = async () => {
      loading.value = true
      error.value = ''
      try {
        const res = await apiV2('/dashboard/summary')
        data.value = res.data
      } catch (e) {
        error.value = e.message
      } finally {
        loading.value = false
      }
    }

    const goto = (path) => router.push(path)
    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')

    onMounted(load)
    return { loading, error, data, goto, fmt }
  }
}
</script>

<style scoped>
.page { padding: 24px; }
.page-title { font-size: 22px; margin-bottom: 20px; color: #333; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
.card { background: #fff; border-radius: 10px; padding: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); cursor: default; transition: transform .2s; }
.card:hover { transform: translateY(-2px); }
.card-ok { border-left: 4px solid #52c41a; }
.card-warn { border-left: 4px solid #faad14; }
.card-label { color: #888; font-size: 13px; margin-bottom: 8px; }
.card-value { font-size: 26px; font-weight: 600; color: #333; }
.card-sub { color: #999; font-size: 12px; margin-top: 4px; }
.panel { background: #fff; border-radius: 10px; padding: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
.panel-title { font-size: 16px; margin-bottom: 14px; color: #333; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
.data-table th { color: #888; font-weight: 500; }
.loading, .error-box, .empty { padding: 40px; text-align: center; color: #999; }
.error-box { color: #d4380d; }
</style>