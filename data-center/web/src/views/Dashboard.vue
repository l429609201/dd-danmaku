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
          <div class="card-sub">429 兜底 {{ data.today.fallback_hits }}</div>
        </div>
        <div class="card">
          <div class="card-label">今日 429 兜底</div>
          <div class="card-value">{{ data.today.fallback_hits }}</div>
          <div class="card-sub">缓存命中 {{ data.today.cache_hits }}</div>
        </div>
        <div class="card card-accent" @click="goto('/key-pool')">
          <div class="card-label">密钥池</div>
          <div class="card-value">{{ insightCards ? insightCards.keyTotal : '—' }}</div>
          <div class="card-sub">限流中 {{ insightCards ? insightCards.keyLimited : 0 }} 项</div>
        </div>
        <div class="card" :class="cs && cs.usage_ratio > 90 ? 'card-warn' : ''" @click="goto('/comment-store')">
          <div class="card-label">弹幕存储水位</div>
          <div class="card-value">{{ cs ? cs.usage_ratio + '%' : '—' }}</div>
          <div class="card-sub" v-if="cs">{{ fmtBytes(cs.total_size_bytes) }} / {{ fmtBytes(cs.max_bytes) }}</div>
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
        <div v-show="trendHasData" ref="trendChart" class="chart"></div>
        <div v-show="!trendHasData" class="empty">暂无趋势数据（需 Worker 连接并上报指标后生成）</div>
      </div>

      <!-- 分布图表：状态码 / 拦截 / 命中 -->
      <div class="chart-grid">
        <div class="panel">
          <h2 class="panel-title">状态码分布（今日）</h2>
          <div v-show="hasDist" ref="statusChart" class="chart chart-sm"></div>
          <div v-show="!hasDist" class="empty">暂无数据</div>
        </div>
        <div class="panel">
          <h2 class="panel-title">拦截类型分布（今日）</h2>
          <div v-show="hasBlocked" ref="blockChart" class="chart chart-sm"></div>
          <div v-show="!hasBlocked" class="empty">今日无拦截</div>
        </div>
        <div class="panel">
          <h2 class="panel-title">缓存命中构成（今日）</h2>
          <div v-show="hasHit" ref="hitChart" class="chart chart-sm"></div>
          <div v-show="!hasHit" class="empty">暂无命中数据</div>
        </div>
      </div>

      <!-- 运维洞察 -->
      <h2 class="section-title">运维洞察（近 24h）</h2>
      <div class="chart-grid">
        <div class="panel">
          <h2 class="panel-title">各接口上游限流（近 24h）</h2>
          <div v-show="has429" ref="api429Chart" class="chart chart-sm"></div>
          <div v-show="!has429" class="empty">近 24h 无上游限流</div>
        </div>
        <div class="panel">
          <h2 class="panel-title">UA 来源 Top（近 24h）</h2>
          <div v-show="hasUaTop" ref="uaTopChart" class="chart chart-sm"></div>
          <div v-show="!hasUaTop" class="empty">暂无 UA 数据</div>
        </div>
        <div class="panel">
          <h2 class="panel-title">缓存来源构成（近 24h）</h2>
          <div v-show="hasCacheSrc" ref="cacheSrcChart" class="chart chart-sm"></div>
          <div v-show="!hasCacheSrc" class="empty">暂无来源数据</div>
        </div>
      </div>

      <!-- 请求来源地图 -->
      <div class="panel" style="margin: 24px 0;">
        <h2 class="panel-title">请求来源分布
          <span class="map-sub" v-if="geo && geo.available">已解析 {{ geo.resolved }} / {{ geo.total_ips }} 个 IP</span>
        </h2>
        <div v-show="geoAvailable" ref="mapChart" class="chart chart-map"></div>
        <div v-show="!geoAvailable" class="empty">
          未配置 IP 地理库。请下载 GeoLite2-City.mmdb 放到 /app/config/ 后重启
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
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import * as echarts from 'echarts'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'Dashboard',
  setup() {
    const router = useRouter()
    const loading = ref(true)
    const error = ref('')
    const data = ref(null)
    const geo = ref(null)
    // 图表 DOM 引用
    const trendChart = ref(null)
    const statusChart = ref(null)
    const blockChart = ref(null)
    const hitChart = ref(null)
    const mapChart = ref(null)
    // 运维洞察图表引用
    const api429Chart = ref(null)
    const uaTopChart = ref(null)
    const cacheSrcChart = ref(null)
    // 图表实例（统一管理便于 resize/dispose）
    const charts = {}
    // 数据有无标志（控制空态显示）
    const trendHasData = ref(false)
    const hasDist = ref(false)
    const hasBlocked = ref(false)
    const hasHit = ref(false)
    const geoAvailable = ref(false)
    // 运维洞察状态
    const has429 = ref(false)
    const hasUaTop = ref(false)
    const hasCacheSrc = ref(false)
    const insightCards = ref(null)
    const cs = ref(null)  // 弹幕存储统计

    const wm = computed(() => (data.value ? data.value.worker_metrics_today : null))

    const load = async () => {
      loading.value = true
      error.value = ''
      try {
        const res = await apiV2('/dashboard/summary')
        data.value = res.data
        loading.value = false
        await nextTick()
        // 并行渲染各图表，互不阻塞
        renderTodayCharts()
        loadTrends()
        loadGeoMap()
        loadInsights()
      } catch (e) {
        error.value = e.message
        loading.value = false
      }
    }

    // 今日分布饼图（状态码/拦截/命中），数据来自 summary
    const renderTodayCharts = () => {
      const m = data.value && data.value.worker_metrics_today
      if (!m) return
      // 状态码分布
      const statusData = [
        { name: '2xx', value: m.status_2xx || 0, itemStyle: { color: '#52c41a' } },
        { name: '4xx', value: m.status_4xx || 0, itemStyle: { color: '#faad14' } },
        { name: '5xx', value: m.status_5xx || 0, itemStyle: { color: '#ff4d4f' } },
      ].filter(x => x.value > 0)
      hasDist.value = statusData.length > 0
      if (hasDist.value) drawPie(statusChart, '状态码', statusData)
      // 拦截类型分布
      const blockData = [
        { name: 'IP 拦截', value: m.blocked_ip || 0 },
        { name: 'UA 拦截', value: m.blocked_ua || 0 },
        { name: '滥用封禁', value: m.blocked_abuse || 0 },
        { name: '非法路由', value: m.invalid_route || 0 },
      ].filter(x => x.value > 0)
      hasBlocked.value = blockData.length > 0
      if (hasBlocked.value) drawPie(blockChart, '拦截', blockData)
      // 命中构成
      const hitData = [
        { name: '内存命中', value: m.mem_cache_hits || 0, itemStyle: { color: '#1677ff' } },
        { name: 'R2 命中', value: m.r2_cache_hits || 0, itemStyle: { color: '#13c2c2' } },
        { name: '回源', value: m.cache_miss || 0, itemStyle: { color: '#faad14' } },
      ].filter(x => x.value > 0)
      hasHit.value = hitData.length > 0
      if (hasHit.value) drawPie(hitChart, '命中', hitData)
    }

    const drawPie = (elRef, name, seriesData) => {
      if (!elRef.value) return
      const c = echarts.init(elRef.value)
      charts[name] = c
      c.setOption({
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        // 图例改到右侧纵向滚动，一次可见多项（原底部横向滚动只能 ◀1/n▶ 翻页）
        legend: {
          type: 'scroll', orient: 'vertical', right: 8, top: 'middle',
          itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11 },
          formatter: (v) => (v && v.length > 10 ? v.slice(0, 10) + '…' : v),
        },
        series: [{
          // 饼图左移并缩半径，给右侧图例腾出空间
          name, type: 'pie', radius: ['38%', '62%'], center: ['38%', '50%'],
          data: seriesData, label: { show: false }, emphasis: { label: { show: true } },
        }],
      })
    }

    // 横向柱状图（接口429 / UA Top）
    const drawBar = (elRef, name, categories, values, color) => {
      if (!elRef.value) return
      const c = echarts.init(elRef.value)
      charts[name] = c
      c.setOption({
        // tooltip 显示完整类目名（Y 轴标签会被截断，靠 tooltip 看全名）
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        grid: { left: 8, right: 16, top: 10, bottom: 8, containLabel: true },
        xAxis: { type: 'value', minInterval: 1 },
        yAxis: {
          type: 'category', data: categories,
          axisLabel: {
            fontSize: 11,
            width: 96, overflow: 'truncate', // 限宽并截断，避免长名重叠糊成一团
            formatter: (v) => (v && v.length > 12 ? v.slice(0, 12) + '…' : v),
          },
        },
        series: [{
          name, type: 'bar', data: values, barMaxWidth: 22,
          itemStyle: { color: color || '#1677ff', borderRadius: [0, 4, 4, 0] },
        }],
      })
    }

    // 加载运维洞察：密钥池状态 + 弹幕水位 + 429/UA/缓存来源
    const loadInsights = async () => {
      // 密钥池状态卡 + 弹幕水位（独立 try，互不影响）
      try {
        const st = await apiV2('/key-pool/states')
        const states = (st.data && st.data.items) || []
        let total = 0, limited = 0
        states.forEach(s => {
          total = Math.max(total, s.key_count || 0)
          const ks = s.key_state || {}
          Object.values(ks).forEach(grp => {
            Object.values(grp || {}).forEach(v => { if (v && v.limited) limited++ })
          })
        })
        insightCards.value = { keyTotal: total, keyLimited: limited }
      } catch (e) { /* 忽略 */ }
      try {
        const r = await apiV2('/comment-store/stats')
        cs.value = r.data
      } catch (e) { /* 忽略 */ }
      // 洞察图表
      try {
        const res = await apiV2('/dashboard/insights?hours=24')
        const d = res.data || {}
        await nextTick()
        const a429 = (d.api_429 || []).filter(x => x.count > 0)
        has429.value = a429.length > 0
        if (has429.value) drawBar(api429Chart, '接口429', a429.map(x => x.api_group), a429.map(x => x.count), '#ff4d4f')
        const uaTop = (d.ua_top || []).slice(0, 10).reverse()
        hasUaTop.value = uaTop.length > 0
        if (hasUaTop.value) drawBar(uaTopChart, 'UA Top', uaTop.map(x => x.ua_type), uaTop.map(x => x.count), '#1677ff')
        const srcData = (d.cache_sources || []).filter(x => x.count > 0)
          .map(x => ({ name: x.source, value: x.count }))
        hasCacheSrc.value = srcData.length > 0
        if (hasCacheSrc.value) drawPie(cacheSrcChart, '缓存来源', srcData)
      } catch (e) { /* 忽略 */ }
    }

    // 加载并渲染 Worker 流量趋势图
    const loadTrends = async () => {
      try {
        const res = await apiV2('/dashboard/metrics-trends?days=7')
        const d = res.data
        // 判断是否有非零数据点
        const sum = (arr) => (arr || []).reduce((a, b) => a + (b || 0), 0)
        trendHasData.value = sum(d.requests) + sum(d.hits) + sum(d.miss) + sum(d.blocked) > 0
        if (!trendHasData.value) return
        await nextTick()
        if (!trendChart.value) return
        const c = echarts.init(trendChart.value)
        charts.trend = c
        c.setOption({
          tooltip: { trigger: 'axis' },
          legend: { data: ['请求', '命中', '回源', '拦截'] },
          grid: { left: 50, right: 20, top: 40, bottom: 30 },
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

    // 加载并渲染请求来源地图（城市级散点）
    const loadGeoMap = async () => {
      try {
        const res = await apiV2('/dashboard/ip-geo')
        geo.value = res.data
        geoAvailable.value = !!(res.data && res.data.available && res.data.points.length)
        if (!geoAvailable.value) return
        await nextTick()
        if (!mapChart.value) return
        // 运行时加载世界地图 GeoJSON（echarts5 不再内置；失败则降级为无底图散点）
        let worldJson = null
        if (!echarts.getMap('world')) {
          worldJson = await fetch('https://fastly.jsdelivr.net/npm/echarts@4.9.0/map/json/world.json')
            .then(r => r.ok ? r.json() : null).catch(() => null)
          if (worldJson) echarts.registerMap('world', worldJson)
        }
        const hasMap = !!echarts.getMap('world')
        const c = echarts.init(mapChart.value)
        charts.map = c
        const pts = geo.value.points
        const maxV = Math.max(...pts.map(p => p.value[2]), 1)
        c.setOption({
          tooltip: { trigger: 'item', formatter: (p) => `${p.name}<br/>请求量: ${p.value ? p.value[2] : 0}` },
          visualMap: { min: 0, max: maxV, calculable: true, left: 10, bottom: 10,
            inRange: { color: ['#a3d2ff', '#1677ff', '#ff4d4f'] } },
          geo: hasMap ? { map: 'world', roam: true, itemStyle: { areaColor: '#f0f2f5', borderColor: '#ccc' } } : undefined,
          series: [{
            type: 'scatter', coordinateSystem: hasMap ? 'geo' : undefined,
            data: pts, symbolSize: (v) => 6 + (v[2] / maxV) * 24,
            encode: { value: 2 },
          }],
        })
      } catch (e) { /* 地图失败不阻塞 */ }
    }

    const onResize = () => { Object.values(charts).forEach(c => c && c.resize()) }

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
      Object.values(charts).forEach(c => c && c.dispose())
    })
    return {
      loading, error, data, wm, geo, goto, fmt, fmtBytes,
      trendChart, statusChart, blockChart, hitChart, mapChart,
      trendHasData, hasDist, hasBlocked, hasHit, geoAvailable,
      api429Chart, uaTopChart, cacheSrcChart,
      has429, hasUaTop, hasCacheSrc, insightCards, cs,
    }
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
.chart-sm { height: 260px; }
.chart-map { height: 460px; }
.chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
.map-sub { font-size: 12px; color: #999; font-weight: normal; margin-left: 10px; }
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