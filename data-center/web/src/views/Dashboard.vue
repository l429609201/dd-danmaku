<template>
  <div class="app-page">
    <h1 class="app-page__title">仪表盘</h1>

    <div v-loading="loading" class="dash-wrap">
      <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="mb16" />

      <el-row :gutter="16" class="mb16">
        <el-col :xs="12" :sm="8" :md="6" v-for="c in cards" :key="c.label">
          <el-card shadow="hover" class="stat-card" :body-style="{ padding: '18px' }"
                   @click="c.path && goto(c.path)">
            <div class="stat-label">
              <el-icon><component :is="c.icon" /></el-icon>
              {{ c.label }}
            </div>
            <div class="stat-value" :class="c.cls">{{ c.value }}</div>
            <div v-if="c.sub" class="stat-sub">{{ c.sub }}</div>
          </el-card>
        </el-col>
      </el-row>

      <el-card shadow="never" class="mb16">
        <template #header>
          <div class="card-head">
            <span>近 7 天缓存命中 / 429 兜底 / 未命中趋势</span>
            <el-button size="small" @click="loadTrends">刷新</el-button>
          </div>
        </template>
        <v-chart v-if="chartOption" class="chart" :option="chartOption" autoresize />
        <el-empty v-else description="暂无趋势数据" />
      </el-card>

      <el-card shadow="never">
        <template #header>最近错误事件</template>
        <el-table :data="recentErrors" size="small" empty-text="暂无错误事件">
          <el-table-column prop="event" label="事件" width="200" />
          <el-table-column prop="message" label="消息" show-overflow-tooltip />
          <el-table-column label="时间" width="180">
            <template #default="{ row }">{{ fmt(row.created_at) }}</template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, markRaw } from 'vue'
import { useRouter } from 'vue-router'
import { apiV2 } from '../utils/api.js'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import {
  DataLine, Box, VideoCamera, Refresh, CircleCheck, Warning,
} from '@element-plus/icons-vue'

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, LegendComponent])

export default {
  name: 'Dashboard',
  components: { VChart },
  setup() {
    const router = useRouter()
    const loading = ref(true)
    const error = ref('')
    const summary = ref(null)
    const trends = ref(null)

    const cards = computed(() => {
      const d = summary.value
      if (!d) return []
      return [
        { label: 'Worker 连接', value: d.worker.connected ? '在线' : '离线', sub: '节点: ' + (d.worker.node_id || '—'), cls: d.worker.connected ? 'ok' : 'warn', icon: markRaw(DataLine) },
        { label: '缓存总数', value: d.totals.cache_count, path: '/cache', icon: markRaw(Box) },
        { label: '集数链接', value: d.totals.episode_links, path: '/episodes', icon: markRaw(VideoCamera) },
        { label: '待刷新任务', value: d.totals.refresh_pending, icon: markRaw(Refresh) },
        { label: '今日缓存命中', value: d.today.cache_hits, cls: 'ok', icon: markRaw(CircleCheck) },
        { label: '今日 429 兜底', value: d.today.fallback_hits, cls: 'warn', icon: markRaw(Warning) },
      ]
    })

    const recentErrors = computed(() => (summary.value && summary.value.recent_errors) || [])

    const chartOption = computed(() => {
      const t = trends.value
      if (!t || !t.labels || !t.labels.length) return null
      return {
        tooltip: { trigger: 'axis' },
        legend: { data: ['命中', '429兜底', '未命中'] },
        grid: { left: 40, right: 16, top: 40, bottom: 30 },
        xAxis: { type: 'category', data: t.labels.map(s => s.slice(5)) },
        yAxis: { type: 'value' },
        series: [
          { name: '命中', type: 'line', smooth: true, data: t.hit, itemStyle: { color: '#52c41a' } },
          { name: '429兜底', type: 'line', smooth: true, data: t.fallback, itemStyle: { color: '#faad14' } },
          { name: '未命中', type: 'line', smooth: true, data: t.miss, itemStyle: { color: '#ff4d4f' } },
        ],
      }
    })

    const loadSummary = async () => {
      try {
        const res = await apiV2('/dashboard/summary')
        summary.value = res.data
      } catch (e) { error.value = e.message }
    }
    const loadTrends = async () => {
      try {
        const res = await apiV2('/dashboard/trends?days=7')
        trends.value = res.data
      } catch (e) { error.value = e.message }
    }

    const goto = (p) => router.push(p)
    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')

    onMounted(async () => {
      loading.value = true
      await Promise.all([loadSummary(), loadTrends()])
      loading.value = false
    })

    return { loading, error, cards, recentErrors, chartOption, goto, fmt, loadTrends }
  }
}
</script>

<style scoped>
.dash-wrap { min-height: 200px; }
.mb16 { margin-bottom: 16px; }
.stat-card { cursor: pointer; margin-bottom: 16px; }
.stat-label { display: flex; align-items: center; gap: 6px; color: var(--app-text-secondary); font-size: 13px; }
.stat-value { font-size: 26px; font-weight: 600; margin-top: 8px; color: var(--app-text); }
.stat-value.ok { color: #52c41a; }
.stat-value.warn { color: #faad14; }
.stat-sub { color: #aaa; font-size: 12px; margin-top: 4px; }
.card-head { display: flex; justify-content: space-between; align-items: center; }
.chart { height: 300px; width: 100%; }
</style>