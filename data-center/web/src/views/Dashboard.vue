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

      <!-- Worker 今日运行指标（CF 侧真实流量） -->
      <h2 class="section-title">Worker 今日流量（CF 侧）</h2>
      <div class="cards" v-if="wm">
        <div class="card card-accent">
          <div class="card-label">请求数</div>
          <div class="card-value">{{ wm.total_requests }}</div>
          <div class="card-sub">响应 {{ wm.total_responses }}</div>
        </div>
        <div class="card">
          <div class="card-label">缓存命中率</div>
          <div class="card-value">{{ wm.hit_rate }}%</div>
          <div class="card-sub">命中 {{ wm.cache_hits }} / 回源 {{ wm.cache_miss }}</div>
        </div>
        <div class="card">
          <div class="card-label">命中明细</div>
          <div class="card-value">{{ wm.cache_hits }}</div>
          <div class="card-sub">内存 {{ wm.mem_cache_hits }} / R2 {{ wm.r2_cache_hits }}</div>
        </div>
        <div class="card">
          <div class="card-label">出/入流量</div>
          <div class="card-value">{{ fmtBytes(wm.bytes_out) }}</div>
          <div class="card-sub">入 {{ fmtBytes(wm.bytes_in) }}</div>
        </div>
        <div class="card" :class="wm.blocked_total > 0 ? 'card-warn' : ''">
          <div class="card-label">拦截总数</div>
          <div class="card-value">{{ wm.blocked_total }}</div>
          <div class="card-sub">IP {{ wm.blocked_ip }} / UA {{ wm.blocked_ua }} / 封禁 {{ wm.blocked_abuse }}</div>
        </div>
        <div class="card" :class="wm.invalid_route > 0 ? 'card-warn' : ''">
          <div class="card-label">非法路由</div>
          <div class="card-value">{{ wm.invalid_route }}</div>
          <div class="card-sub">上游 429: {{ wm.upstream_429 }}</div>
        </div>
      </div>

      <!-- Worker 近 7 天趋势图 -->
      <div class="panel" style="margin-bottom: 24px;">
        <h2 class="panel-title">近 7 天 Worker 流量趋势</h2>
        <div ref="trendChart" class="chart"></div>
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
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'Dashboard',
  setup() {
    const router = useRouter()
    const loading = ref(true)
    const error = ref('')
    const data = ref(null)
    const trendChart = ref(null)
    let chartInstance = null

    // Worker 今日指标（summary 里的 worker_metrics_today）
    const wm = computed(() => (data.value ? data.value.worker_metrics_today : null))

    const load = async () => {
      loading.value = true
      error.value = ''
      try {
        const res = await apiV2('/dashboard/summary')
        data.value = res.data
        await nextTick()
        await loadTrends()
      } catch (e) {
        error.value = e.message
      } finally {
        loading.value = false
      }
    }

    // 加载并渲染 Worker 流量趋势图
    const loadTrends = async () => {
      if (!trendChart.value) return
      try {
        const res = await apiV2('/dashboard/metrics-trends?days=7')
        const d = res.data
        // 动态加载 echarts，避免打进主 chunk
        const echarts = await import('echarts')
        if (!chartInstance) chartInstance = echarts.init(trendChart.value)
        chartInstance.setOption({
          tooltip: { trigger: 'axis' },
          legend: { data: ['请求', '命中', '回源', '拦截'] },
          grid: { left: 40, right: 20, top: 40, bottom: 30 },
          xAxis: { type: 'category', data: d.labels },
          yAxis: { type: 'value' },
          series: [
            { name: '请求', type: 'line', smooth: true, data: d.requests, itemStyle: { color: '#1677ff' } },
            { name: '命中', type: 'line', smooth: true, data: d.hits, itemStyle: { color: '#52c41a' } },
            { name: '回源', type: 'line', smooth: true, data: d.miss, itemStyle: { color: '#faad14' } },
            { name: '拦截', type: 'line', smooth: true, data: d.blocked, itemStyle: { color: '#ff4d4f' } },
          ],
        })
      } catch (e) { /* 趋势图失败不阻塞页面 */ }
    }

    const onResize = () => { if (chartInstance) chartInstance.resize() }

    const goto = (path) => router.push(path)
    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')
    // 字节数人类可读
    const fmtBytes = (n) => {
      n = Number(n) || 0
      if (n < 1024) return n + ' B'
      if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'
      if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB'
      return (n / 1073741824).toFixed(2) + ' GB'
    }

    onMounted(() => { load(); window.addEventListener('resize', onResize) })
    onUnmounted(() => {
      window.removeEventListener('resize', onResize)
      if (chartInstance) { chartInstance.dispose(); chartInstance = null }
    })
    return { loading, error, data, wm, trendChart, goto, fmt, fmtBytes }
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
.card-accent { border-left: 4px solid #1677ff; }
.section-title { font-size: 16px; margin: 8px 0 14px; color: #555; }
.chart { width: 100%; height: 320px; }
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