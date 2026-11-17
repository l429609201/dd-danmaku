<template>
  <section>
    <h2>Rust IP 请求明细（非聚合统计）</h2>
    <p role="status">{{ nativeError }}</p>
    <input v-model="nativeIp" placeholder="精确 IP 筛选" /><button @click="nativePage = 1; loadNative()">查询明细</button>
    <table><thead><tr><th>IP</th><th>路径</th><th>方法</th><th>状态</th><th>时间</th><th>耗时</th></tr></thead>
      <tbody><tr v-for="r in nativeRows" :key="r.id"><td>{{ r.ip_address }}</td><td>{{ r.path }}</td><td>{{ r.method }}</td><td>{{ r.status_code }}</td><td>{{ fmt(r.request_time) }}</td><td>{{ r.response_time_ms ?? '—' }}</td></tr></tbody>
    </table>
    <button :disabled="nativePage <= 1" @click="nativePage--; loadNative()">上一页</button>{{ nativePage }} / {{ Math.max(1, Math.ceil(nativeTotal / 50)) }}<button :disabled="nativePage * 50 >= nativeTotal" @click="nativePage++; loadNative()">下一页</button>
    <p role="alert" class="contract-warning">Rust 当前仅实现逐请求 IP 日志与 Top 10 计数，尚未实现本页按 Worker 聚合、违规数、路径统计、排序与时间筛选。 原功能保留，等待后端补齐；当前不发送旧接口请求。</p>
    <fieldset disabled style="border: 0; padding: 0; margin: 0; min-width: 0; opacity: .65">
  <div class="page">
    <h1 class="page-title">IP 请求统计</h1>
    <div class="toolbar">
      <input v-model="keyword" class="input" placeholder="搜索 IP" @keyup.enter="reload" />
      <select v-model="orderBy" class="input" @change="reload">
        <option value="total_count">按请求量</option>
        <option value="violation_count">按违规数</option>
      </select>
      <!-- 时间范围：按最近访问时间过滤（该列已建索引） -->
      <select v-model="range" class="input" @change="onRange">
        <option value="">全部时间</option>
        <option value="1h">近 1 小时</option>
        <option value="6h">近 6 小时</option>
        <option value="24h">近 24 小时</option>
        <option value="7d">近 7 天</option>
        <option value="30d">近 30 天</option>
        <option value="custom">自定义…</option>
      </select>
      <template v-if="range === 'custom'">
        <input v-model="startAt" class="input" type="datetime-local" title="起始时间" />
        <span class="range-sep">至</span>
        <input v-model="endAt" class="input" type="datetime-local" title="结束时间" />
      </template>
      <button class="btn btn-primary" @click="reload">查询</button>
    </div>

    <div v-if="rangeHint" class="range-hint">{{ rangeHint }}</div>

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
      <div v-if="totalEstimated" class="est-tip">
        总数超过 {{ total }} 条，仅显示估算值（避免大表全表计数）
      </div>
    </div>
  </div>
    </fieldset>
  </section>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import { apiV2 as nativeApi } from '../utils/api.js'
// 旧聚合业务语义尚未在 Rust 实现：保留页面但阻止旧接口及误写请求。
const apiV2 = async () => { throw new Error('当前 Rust 后端尚未实现此页面的业务契约') }
import Pager from '../components/Pager.vue'

export default {
  name: 'IpStats',
  components: { Pager },
  setup() {
    const nativeRows = ref([]), nativeTotal = ref(0), nativePage = ref(1), nativeIp = ref(''), nativeError = ref('')
    const loadNative = async () => {
      try {
        // Rust 返回逐请求 stats；不能用它伪造违规计数或 Worker 聚合。
        const q = new URLSearchParams({ page: nativePage.value, page_size: 50 })
        if (nativeIp.value.trim()) q.set('ip', nativeIp.value.trim())
        const res = await nativeApi(`/logs/ip-stats?${q}`)
        if (!Array.isArray(res?.stats)) throw new Error('Rust IP 明细响应不符合契约')
        nativeRows.value = res.stats; nativeTotal.value = res.total; nativeError.value = ''
      } catch (e) { nativeError.value = e.message }
    }
    onMounted(loadNative)
    const items = ref([])
    const total = ref(0)
    const totalEstimated = ref(false)  // 后端截断 COUNT 时为 true
    const page = ref(1)
    const pageSize = ref(50)
    const keyword = ref('')
    const orderBy = ref('total_count')
    const msg = ref('')
    // 时间过滤：range 为快捷区间，custom 时用 startAt/endAt 两个 datetime-local
    const range = ref('')
    const startAt = ref('')
    const endAt = ref('')

    // 各快捷区间对应的毫秒数
    const RANGE_MS = {
      '1h': 3600e3, '6h': 6 * 3600e3, '24h': 24 * 3600e3,
      '7d': 7 * 24 * 3600e3, '30d': 30 * 24 * 3600e3,
    }

    // 把 Date 转成后端可解析的 'YYYY-MM-DD HH:mm:ss'（本地时间，与库内 naive 一致）
    const toLocalStr = (d) => {
      const p = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
             `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    }

    // 依据当前选择计算 start/end 查询参数；返回 null 表示不过滤
    const resolveRange = () => {
      if (range.value === 'custom') {
        return {
          start: startAt.value ? startAt.value.replace('T', ' ') + ':00' : '',
          end: endAt.value ? endAt.value.replace('T', ' ') + ':00' : '',
        }
      }
      const ms = RANGE_MS[range.value]
      if (!ms) return { start: '', end: '' }
      return { start: toLocalStr(new Date(Date.now() - ms)), end: '' }
    }

    const rangeHint = computed(() => {
      if (!range.value) return ''
      const { start, end } = resolveRange()
      if (!start && !end) return ''
      return `按最近访问时间过滤：${start || '不限'} ~ ${end || '现在'}`
    })

    const load = async () => {
      msg.value = ''
      try {
        const q = new URLSearchParams({ page: page.value, page_size: pageSize.value, order_by: orderBy.value })
        if (keyword.value) q.set('keyword', keyword.value)
        const { start, end } = resolveRange()
        if (start) q.set('start', start)
        if (end) q.set('end', end)
        const res = await apiV2(`/ip-stats/current?${q.toString()}`)
        items.value = res.items || []
        total.value = res.total || 0
        totalEstimated.value = !!res.total_estimated
      } catch (e) { msg.value = e.message }
    }

    // 切换区间：回到第一页再查；选自定义时等用户填完点查询
    const onRange = () => {
      page.value = 1
      if (range.value !== 'custom') load()
    }
    const reload = () => { page.value = 1; load() }

    const goPage = (p) => { page.value = p; load() }
    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')
    const topPaths = (paths) => {
      if (!paths || typeof paths !== 'object') return '—'
      const entries = Object.entries(paths).sort((a, b) => b[1] - a[1]).slice(0, 3)
      return entries.length ? entries.map(([k, v]) => `${k}:${v}`).join(', ') : '—'
    }

    onMounted(load)
    return { nativeRows, nativeTotal, nativePage, nativeIp, nativeError, loadNative, items, total, totalEstimated, page, pageSize, keyword, orderBy, msg,
      range, startAt, endAt, rangeHint, load, reload, onRange, goPage, fmt, topPaths }
  }
}
</script>

<style scoped>
.page { padding: 24px; }
.page-title { font-size: 22px; margin-bottom: 20px; color: var(--color-text); }
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; align-items: center; }
.range-sep { color: var(--color-text-secondary); font-size: 13px; }
.range-hint { color: var(--color-text-secondary); font-size: 12px; margin-bottom: 12px; }
.est-tip { color: var(--color-text-secondary); font-size: 12px; margin-top: 8px; text-align: right; }
.input { padding: 8px 12px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-bg); color: var(--color-text); }
.btn { padding: 8px 16px; border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text); border-radius: 6px; cursor: pointer; }
.btn:disabled { opacity: .6; cursor: not-allowed; }
.btn-primary { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.tip { background: color-mix(in srgb, var(--color-primary) 8%, transparent); border: 1px solid color-mix(in srgb, var(--color-primary) 25%, transparent); padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; color: var(--color-primary); }
.panel { background: var(--color-bg); border-radius: 10px; padding: 18px; box-shadow: var(--shadow-sm); border: 1px solid var(--color-border-light); }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--color-border-lighter); font-size: 13px; }
.data-table th { color: var(--color-text-secondary); font-weight: 500; }
.key { font-family: monospace; font-size: 12px; }
.warn { color: var(--color-danger); font-weight: 600; }
.paths { color: var(--color-text-secondary); font-size: 12px; max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
.empty { text-align: center; color: var(--color-text-disabled); padding: 20px; }
.pager { display: flex; gap: 12px; align-items: center; margin-top: 14px; justify-content: flex-end; }
</style>
