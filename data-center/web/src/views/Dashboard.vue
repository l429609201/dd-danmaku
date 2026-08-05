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
      </div>

      <!-- 本地端系统资源（CPU / 内存实时占用） -->
      <h2 class="section-title">本地端系统资源</h2>
      <div class="cards" v-if="sys && sys.available">
        <div class="card" :class="sys.cpu.system_percent > 85 ? 'card-warn' : 'card-accent'">
          <div class="card-label">系统 CPU</div>
          <div class="card-value">{{ sys.cpu.system_percent }}%</div>
          <div class="card-sub">{{ sys.cpu.cores }} 核</div>
        </div>
        <div class="card" :class="sys.cpu.process_percent > 60 ? 'card-warn' : ''">
          <div class="card-label">本进程 CPU</div>
          <div class="card-value">{{ sys.cpu.process_percent }}%</div>
          <div class="card-sub">整机占比（已按核数归一）</div>
        </div>
        <div class="card" :class="sys.memory.system_percent > 90 ? 'card-warn' : 'card-accent'">
          <div class="card-label">系统内存</div>
          <div class="card-value">{{ sys.memory.system_percent }}%</div>
          <div class="card-sub">{{ fmtBytes(sys.memory.system_used) }} / {{ fmtBytes(sys.memory.system_total) }}</div>
        </div>
        <div class="card">
          <div class="card-label">本进程内存</div>
          <div class="card-value">{{ fmtBytes(sys.memory.process_rss) }}</div>
          <div class="card-sub">占系统 {{ sys.memory.process_percent }}%</div>
        </div>
        <div class="card" v-if="sys.cpu.load1 !== null && sys.cpu.load1 !== undefined">
          <div class="card-label">系统负载</div>
          <div class="card-value">{{ sys.cpu.load1 }}</div>
          <div class="card-sub">5分钟 {{ sys.cpu.load5 }} / 15分钟 {{ sys.cpu.load15 }}</div>
        </div>
        <div class="card" v-if="sys.process" :class="loopLagClass">
          <div class="card-label">事件循环延迟</div>
          <div class="card-value">{{ sys.eventloop ? sys.eventloop.loop_lag_ms : '—' }} ms</div>
          <div class="card-sub">运行任务 {{ sys.eventloop ? sys.eventloop.running_tasks : '—' }} / 线程 {{ sys.process.threads }}</div>
        </div>
        <div class="card" v-if="sys.db_pool && sys.db_pool.checkedout !== undefined" :class="poolClass">
          <div class="card-label">DB 连接池</div>
          <div class="card-value">{{ sys.db_pool.checkedout }}/{{ (sys.db_pool.size || 0) + (sys.db_pool.overflow || 0) }}</div>
          <div class="card-sub">在用 {{ sys.db_pool.checkedout }} / 空闲 {{ sys.db_pool.checkedin }}</div>
        </div>
        <div class="card" v-if="sys.queues" :class="queueClass">
          <div class="card-label">削峰队列深度</div>
          <div class="card-value">{{ sys.queues.entity_ingest.depth }}</div>
          <div class="card-sub">日志缓冲 {{ sys.queues.access_log.depth }} / 丢弃 {{ sys.queues.entity_ingest.dropped }}</div>
        </div>
      </div>
      <div class="cards" v-else-if="sys && !sys.available">
        <div class="card"><div class="card-sub">系统资源采集不可用（psutil 缺失或异常）</div></div>
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

      <h2 class="section-title">Cloudflare 工具调用（今日）</h2>
      <div class="cards" v-if="tools">
        <div class="card" v-for="group in toolGroups" :key="group.name"
             :class="group.errors > 0 ? 'card-warn' : 'card-accent'">
          <div class="card-label">{{ group.name }}</div>
          <div class="card-value">{{ group.attempts }}</div>
          <div class="card-sub">成功 {{ group.success }} / 失败 {{ group.errors }}</div>
          <div class="card-sub">{{ group.detail }}</div>
        </div>
      </div>

      <h2 class="section-title">Worker 应用内存水位（最新快照）</h2>
      <div class="cards" v-if="memoryWatermark">
        <div class="card card-accent">
          <div class="card-label">粗略估算</div>
          <div class="card-value">{{ fmtBytes(memoryWatermark.estimated_bytes) }}</div>
          <div class="card-sub">非真实 isolate 内存；真实值请查看 Cloudflare 控制台</div>
        </div>
        <div class="card"><div class="card-label">API 缓存</div><div class="card-value">{{ memoryWatermark.api_cache || 0 }}</div><div class="card-sub">日志 {{ memoryWatermark.logs || 0 }} 条</div></div>
        <div class="card"><div class="card-label">限流 / IP</div><div class="card-value">{{ memoryWatermark.rate_limit_counters || 0 }}</div><div class="card-sub">IP 统计 {{ memoryWatermark.ip_stats || 0 }}</div></div>
        <div class="card"><div class="card-label">OAuth / 空结果</div><div class="card-value">{{ memoryWatermark.oauth_token_cache || 0 }}</div><div class="card-sub">空结果计数 {{ memoryWatermark.empty_search_counter || 0 }}</div></div>
        <div class="card"><div class="card-label">认证追踪</div><div class="card-value">{{ memoryWatermark.auth_fail_tracker || 0 }}</div><div class="card-sub">封禁 {{ memoryWatermark.auth_ban_tracker || 0 }} / 滥用 {{ memoryWatermark.abuse_tracker || 0 }}</div></div>
        <div class="card"><div class="card-label">DO 水位</div><div class="card-value">{{ memoryWatermark.do_pending_rpc || 0 }}</div><div class="card-sub">WebSocket {{ memoryWatermark.do_websocket_connections || 0 }} / 请求中 {{ memoryWatermark.pending_requests || 0 }}</div></div>
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

      <!-- 运维洞察已改为按日聚合，文案必须与后端 stat_date 口径一致。 -->
      <h2 class="section-title">运维洞察（今日）</h2>
      <div class="chart-grid">
        <div class="panel">
          <h2 class="panel-title">各接口上游限流（今日）</h2>
          <div v-show="has429" ref="api429Chart" class="chart chart-sm"></div>
          <div v-show="!has429" class="empty">今日无上游限流</div>
        </div>
        <div class="panel">
          <h2 class="panel-title">UA 来源 Top（今日）</h2>
          <div v-show="hasUaTop" ref="uaTopChart" class="chart chart-sm"></div>
          <div v-show="!hasUaTop" class="empty">暂无 UA 数据</div>
        </div>
        <div class="panel">
          <h2 class="panel-title">缓存来源构成（今日）</h2>
          <div v-show="hasCacheSrc" ref="cacheSrcChart" class="chart chart-sm"></div>
          <div v-show="!hasCacheSrc" class="empty">暂无来源数据</div>
        </div>
      </div>

      <!-- 请求来源地图 -->
      <div class="panel" style="margin: 24px 0;">
        <h2 class="panel-title">请求来源分布
          <!-- 库文件状态灯：绿=已加载，红=缺库（hover 提示放置路径） -->
          <span class="geo-dot" :class="geoLibReady ? 'geo-dot--ok' : 'geo-dot--err'"
                :title="geoLibReady ? 'GeoLite2 地理库已加载' : '未找到 GeoLite2-City.mmdb，请放到 /app/config/ 后重启后端'"></span>
          <span class="map-sub" v-if="geo && geo.available">已解析 {{ geo.resolved }} / {{ geo.total_ips }} 个 IP</span>
          <span class="map-sub map-sub--err" v-else-if="geo && !geo.available">未配置地理库</span>
        </h2>
        <!-- 世界底图常驻：库可用即渲染，散点逐个动画铺上；库不可用仍显示底图+提示 -->
        <div ref="mapChart" class="chart chart-map"></div>
        <div v-if="!geoLibReady" class="geo-tip">
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
    const geoLibReady = ref(false)  // 地理库文件是否加载成功（状态灯用）
    let geoRenderTimer = null       // 渐进渲染定时器
    // 运维洞察状态
    const has429 = ref(false)
    const hasUaTop = ref(false)
    const hasCacheSrc = ref(false)
    const insightCards = ref(null)
    const cs = ref(null)  // 弹幕存储统计
    const sys = ref(null)  // 本地端系统资源（CPU/内存）
    let sysTimer = null    // 系统资源轮询定时器

    const wm = computed(() => (data.value ? data.value.worker_metrics_today : null))
    const tools = computed(() => (data.value ? data.value.cloudflare_tools_today : null))
    const memoryWatermark = computed(() => (data.value ? data.value.worker_memory_latest : null))
    const toolGroups = computed(() => {
      const src = tools.value || {}
      const build = (name, items) => {
        const rows = items.map(item => [item[1], src[item[0]] || {}])
        const sum = key => rows.reduce((n, row) => n + Number(row[1][key] || 0), 0)
        return {
          name, attempts: sum('attempts'), success: sum('success'), errors: sum('errors'),
          detail: rows.map(row => `${row[0]} ${Number(row[1].attempts || 0)}`).join(' / '),
        }
      }
      return [
        build('R2', [['r2Get', '读取'], ['r2Put', '写入'], ['r2List', '列表'], ['r2Delete', '删除']]),
        build('Durable Object', [['doRpc', 'RPC'], ['doConfig', '配置'], ['doStorageGet', '存储读'], ['doStoragePut', '存储写'], ['doWsSend', 'WS发送']]),
        build('Assets', [['assetsFetch', '静态资源']]),
      ]
    })

    // 运行健康度告警色：超阈值标黄，便于肉眼发现瓶颈
    const loopLagClass = computed(() => {
      const lag = sys.value && sys.value.eventloop ? sys.value.eventloop.loop_lag_ms : 0
      return lag > 100 ? 'card-warn' : ''  // >100ms 说明事件循环被阻塞
    })
    const poolClass = computed(() => {
      const p = sys.value && sys.value.db_pool
      if (!p || p.checkedout === undefined) return ''
      const cap = (p.size || 0) + (p.overflow || 0)
      return cap > 0 && p.checkedout / cap > 0.8 ? 'card-warn' : ''  // 连接池 >80%
    })
    const queueClass = computed(() => {
      const q = sys.value && sys.value.queues
      if (!q) return ''
      const d = q.entity_ingest.depth + q.access_log.depth
      return d > 3000 ? 'card-warn' : ''  // 队列积压
    })

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
        loadSystem()
      } catch (e) {
        error.value = e.message
        loading.value = false
      }
    }

    // 加载本地端系统资源（CPU/内存），失败静默
    const loadSystem = async () => {
      try {
        const res = await apiV2('/dashboard/system')
        sys.value = res.data
      } catch (e) { /* 系统资源采集失败不阻塞页面 */ }
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

    const drawPie = async (elRef, name, seriesData) => {
      if (!elRef.value) return
      // 先等 DOM 真正显示（v-show 刚置 true），否则 0 宽容器会画歪/图例重叠
      await nextTick()
      const c = echarts.getInstanceByDom(elRef.value) || echarts.init(elRef.value)
      charts[name] = c
      c.setOption({
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        // 图例右侧纵向滚动；用百分比宽度区分饼图区与图例区，避免重叠
        legend: {
          type: 'scroll', orient: 'vertical', right: '2%', top: 'middle',
          itemWidth: 10, itemHeight: 10, itemGap: 8,
          textStyle: { fontSize: 11 },
          formatter: (v) => (v && v.length > 8 ? v.slice(0, 8) + '…' : v),
        },
        series: [{
          // 饼图占左 60% 区域居中，右侧 40% 留给图例，杜绝重叠
          name, type: 'pie', radius: ['35%', '58%'], center: ['30%', '50%'],
          data: seriesData, label: { show: false }, emphasis: { label: { show: true } },
        }],
      }, true) // 第二参 true：清空旧 option，避免复用实例残留
      c.resize() // 兜底：确保按当前真实容器尺寸渲染
    }

    // 横向柱状图（接口429 / UA Top）
    const drawBar = async (elRef, name, categories, values, color) => {
      if (!elRef.value) return
      // 先等 DOM 显示，否则 0 宽容器会把整图压成一条竖条
      await nextTick()
      const c = echarts.getInstanceByDom(elRef.value) || echarts.init(elRef.value)
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
      }, true)
      c.resize() // 兜底：按真实容器尺寸重绘，杜绝竖条
    }

    // 缓存来源英文值 → 中文展示（与 WorkerLogs 保持一致）
    const cacheSourceLabel = (s) => ({
      'MEM': '内存缓存',
      'LOCAL': '本地缓存',
      'LOCAL-STALE': '本地缓存(过期)',
      'LOCAL-COMMENT': '本地弹幕兜底',
      'LOCAL-EMPTY': '空结果负缓存',
      'LOCAL-ALIAS-FALLBACK': '本地别名兜底',
      'LOCAL-ASSEMBLED-SERIES': '本地系列组装',
      'LOCAL-ASSEMBLED-EPISODES': '本地分集组装',
      'STALE-QUOTA': '配额超限旧缓存',
      'R2': 'R2缓存',
      'MISS': '未命中(回源)',
      'UPSTREAM-429': '上游限流',
    }[s] || s || '未知')

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
      // 洞察图表（drawBar/drawPie 内部已等 nextTick 再渲染，避免 0 宽容器画歪）
      try {
        // 后端已按 stat_date 聚合；不再传废弃的 hours 参数，默认读取今天。
        const res = await apiV2('/dashboard/insights')
        const d = res.data || {}
        const a429 = (d.api_429 || []).filter(x => x.count > 0)
        has429.value = a429.length > 0
        if (has429.value) drawBar(api429Chart, '接口429', a429.map(x => x.api_group), a429.map(x => x.count), '#ff4d4f')
        const uaTop = (d.ua_top || []).slice(0, 10).reverse()
        hasUaTop.value = uaTop.length > 0
        if (hasUaTop.value) drawBar(uaTopChart, 'UA Top', uaTop.map(x => x.ua_type), uaTop.map(x => x.count), '#1677ff')
        const srcData = (d.cache_sources || []).filter(x => x.count > 0)
          .map(x => ({ name: cacheSourceLabel(x.source), value: x.count }))
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

    // 确保世界底图 GeoJSON 已注册：优先本地 /world.json，失败回退 CDN
    const ensureWorldMap = async () => {
      if (echarts.getMap('world')) return true
      // 1. 本地静态资源（把 world.json 放 public/ 即走本地，无外网依赖）
      let json = await fetch('/world.json').then(r => r.ok ? r.json() : null).catch(() => null)
      // 2. 回退 CDN（本地未放置时兜底）
      if (!json) {
        json = await fetch('https://fastly.jsdelivr.net/npm/echarts@4.9.0/map/json/world.json')
          .then(r => r.ok ? r.json() : null).catch(() => null)
      }
      if (json) { echarts.registerMap('world', json); return true }
      return false
    }

    // 渲染世界底图（常驻，即使 0 个点）
    const renderBaseMap = (hasMap) => {
      if (!mapChart.value) return null
      const c = echarts.getInstanceByDom(mapChart.value) || echarts.init(mapChart.value)
      charts.map = c
      c.setOption({
        tooltip: { trigger: 'item', formatter: (p) => `${p.name}<br/>请求量: ${p.value ? p.value[2] : 0}` },
        visualMap: { min: 0, max: 1, calculable: true, left: 10, bottom: 10,
          inRange: { color: ['#a3d2ff', '#1677ff', '#ff4d4f'] } },
        geo: hasMap ? { map: 'world', roam: true, itemStyle: { areaColor: '#f0f2f5', borderColor: '#ccc' } } : undefined,
        series: [{ type: 'scatter', coordinateSystem: hasMap ? 'geo' : undefined,
          data: [], symbolSize: 6, encode: { value: 2 } }],
      })
      c.resize()
      return c
    }

    // C1 渐进渲染：点按请求量降序，用定时器逐个铺到地图上，视觉上一个个冒出
    const progressiveRender = (c, pts, hasMap) => {
      if (geoRenderTimer) { clearInterval(geoRenderTimer); geoRenderTimer = null }
      const maxV = Math.max(...pts.map(p => p.value[2]), 1)
      // 点多时每帧多铺几个，控制总时长在 ~4 秒内
      const step = Math.max(1, Math.ceil(pts.length / 120))
      let i = 0
      const shown = []
      geoRenderTimer = setInterval(() => {
        if (i >= pts.length) { clearInterval(geoRenderTimer); geoRenderTimer = null; return }
        for (let k = 0; k < step && i < pts.length; k++, i++) shown.push(pts[i])
        c.setOption({
          visualMap: { min: 0, max: maxV },
          series: [{ type: 'scatter', coordinateSystem: hasMap ? 'geo' : undefined,
            data: shown.slice(), symbolSize: (v) => 6 + (v[2] / maxV) * 24, encode: { value: 2 } }],
        })
      }, 30)
    }

    // 加载并渲染请求来源地图（城市级散点，底图常驻 + 渐进动画）
    const loadGeoMap = async () => {
      try {
        const res = await apiV2('/dashboard/ip-geo')
        geo.value = res.data
        // 库是否就绪：available 反映 mmdb 是否加载成功（状态灯 + 提示）
        geoLibReady.value = !!(res.data && res.data.available)
        geoAvailable.value = !!(res.data && res.data.available && res.data.points.length)
        await nextTick()
        if (!mapChart.value) return
        // 底图常驻：无论有无点、库是否可用，都先渲染世界地图
        const hasMap = await ensureWorldMap()
        await nextTick()
        const c = renderBaseMap(hasMap)
        if (!c) return
        // 有点则渐进铺点
        const pts = (geo.value && geo.value.points) || []
        if (pts.length) progressiveRender(c, pts, hasMap)
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

    onMounted(() => {
      load()
      window.addEventListener('resize', onResize)
      // 系统资源每 5 秒轮询刷新（轻量接口，仅采集 CPU/内存）
      sysTimer = setInterval(loadSystem, 5000)
    })
    onUnmounted(() => {
      window.removeEventListener('resize', onResize)
      if (sysTimer) clearInterval(sysTimer)
      if (geoRenderTimer) clearInterval(geoRenderTimer)  // 清渐进渲染定时器
      Object.values(charts).forEach(c => c && c.dispose())
    })
    return {
      loading, error, data, wm, tools, toolGroups, memoryWatermark, geo, goto, fmt, fmtBytes,
      trendChart, statusChart, blockChart, hitChart, mapChart,
      trendHasData, hasDist, hasBlocked, hasHit, geoAvailable, geoLibReady,
      api429Chart, uaTopChart, cacheSrcChart,
      has429, hasUaTop, hasCacheSrc, insightCards, cs, sys,
      loopLagClass, poolClass, queueClass,
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
.map-sub--err { color: #f56c6c; }
/* 库文件状态灯 */
.geo-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%;
  margin-left: 8px; vertical-align: middle; cursor: help; }
.geo-dot--ok { background: #52c41a; box-shadow: 0 0 4px #52c41a; }
.geo-dot--err { background: #f5222d; box-shadow: 0 0 4px #f5222d; }
.geo-tip { margin-top: 8px; font-size: 12px; color: #f56c6c; }
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