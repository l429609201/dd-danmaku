<template>
  <div class="page">
    <h1 class="page-title">数据清理</h1>
    <p v-if="msg" class="msg">{{ msg }}</p>

    <!-- Tab 切换：数据表清理 / 数据清洗 -->
    <div class="tabs">
      <button class="tab" :class="{ active: activeTab === 'table' }" @click="activeTab = 'table'">数据表清理</button>
      <button class="tab" :class="{ active: activeTab === 'clean' }" @click="activeTab = 'clean'">数据清洗</button>
    </div>

    <!-- ============ Tab1：数据表清理 ============ -->
    <template v-if="activeTab === 'table'">
    <!-- 定时任务配置 -->
    <div class="panel">
      <h2 class="panel-title">定时清理任务</h2>
      <div class="sched-row">
        <label class="switch">
          <input type="checkbox" v-model="schedule.enabled" @change="saveSchedule" />
          <span>启用定时清理</span>
        </label>
        <div class="interval">
          执行间隔
          <input type="number" min="1" v-model.number="intervalMin" class="num" @change="saveSchedule" />
          分钟
        </div>
        <button class="btn btn-primary" :disabled="running" @click="runAll">
          {{ running ? '清理中...' : '立即清理(全部启用项)' }}
        </button>
      </div>
    </div>

    <!-- 表策略 -->
    <div class="panel">
      <h2 class="panel-title">可清理表（勾选启用，设置保留天数）</h2>
      <table class="data-table">
        <thead>
          <tr><th>表</th><th>当前行数</th><th>启用</th><th>保留天数</th><th>最后清理</th><th>上次删除</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="p in policies" :key="p.table_key" :class="{ sensitive: !p.is_safe }">
            <td>
              {{ p.display_name }}
              <span v-if="!p.is_safe" class="badge-warn">敏感</span>
            </td>
            <td>{{ p.row_count != null ? p.row_count.toLocaleString() : '—' }}</td>
            <td>
              <label class="switch">
                <input type="checkbox" v-model="p.enabled" @change="savePolicy(p)" />
              </label>
            </td>
            <td>
              <input type="number" min="0" v-model.number="p.retention_days"
                     class="num" @change="savePolicy(p)" />
            </td>
            <td>{{ fmt(p.last_cleanup_at) }}</td>
            <td>{{ p.last_deleted || 0 }}</td>
            <td><button class="link" :disabled="running" @click="runOne(p)">清理此表</button></td>
          </tr>
        </tbody>
      </table>
      <p class="tip">敏感表（红色）删除会影响业务数据/缓存，请谨慎启用。保留天数=0 表示不按天清理。</p>
    </div>
    </template>

    <!-- ============ Tab2：数据清洗 ============ -->
    <template v-else>
    <!-- 专项清理：脏缓存 -->
    <div class="panel">
      <h2 class="panel-title">脏缓存清理</h2>
      <p class="purge-desc">
        清理响应缓存中
        <b>空结果 / success:false / errorCode≠0</b>
        的无效数据（SQL + Redis），修复"搜索命中却返回空"的问题。建议先扫描预览、核查明细后再清理。
      </p>
      <div class="filter-grid">
        <div class="filter-item">
          <label>接口前缀</label>
          <input v-model="dirty.api_path_prefix" class="input" placeholder="留空=全部，如 /api/v2/search/anime" />
        </div>
        <div class="filter-item">
          <label>时间范围</label>
          <select v-model.number="dirty.older_than_days" class="input">
            <option :value="0">全部时间</option>
            <option :value="7">7 天前</option>
            <option :value="30">30 天前</option>
            <option :value="90">90 天前</option>
          </select>
        </div>
        <div class="filter-item">
          <label>脏类型（不选=全部）</label>
          <div class="checks">
            <label><input type="checkbox" value="empty" v-model="dirty.reasons" /> 空结果</label>
            <label><input type="checkbox" value="fail" v-model="dirty.reasons" /> success:false</label>
            <label><input type="checkbox" value="error_code" v-model="dirty.reasons" /> errorCode≠0</label>
          </div>
        </div>
      </div>
      <div class="purge-actions">
        <button class="btn" :disabled="scanning || purging" @click="scanDirty">
          {{ scanning ? '扫描中...' : '先扫描预览' }}
        </button>
        <button class="btn btn-danger" :disabled="purging || scanning || !dirtyTotal" @click="purgeDirty">
          {{ purging ? '清理中...' : '确认清理' }}
        </button>
        <span v-if="scanResult" class="scan-result">{{ scanResult }}</span>
      </div>
    </div>

    <!-- 扫描明细：逐条核查（后端分页） -->
    <div v-if="dirtyTotal" class="panel">
      <h2 class="panel-title">
        脏数据明细
        <span class="detail-sub">共 {{ dirtyTotal }} 条，当前第 {{ detailPage }}/{{ totalPages }} 页</span>
      </h2>
      <!-- 按原因筛选（下推后端重扫） + 每页条数 -->
      <div class="detail-toolbar">
        <div class="detail-filter">
          <button class="chip" :class="{ on: detailFilter === 'all' }" @click="setDetailFilter('all')">全部 {{ dirtyTotal }}</button>
          <button class="chip" :class="{ on: detailFilter === 'empty' }" @click="setDetailFilter('empty')">空结果 {{ byReason.empty || 0 }}</button>
          <button class="chip" :class="{ on: detailFilter === 'fail' }" @click="setDetailFilter('fail')">success:false {{ byReason.fail || 0 }}</button>
          <button class="chip" :class="{ on: detailFilter === 'error_code' }" @click="setDetailFilter('error_code')">errorCode≠0 {{ byReason.error_code || 0 }}</button>
        </div>
        <label class="page-size">
          每页
          <select v-model.number="pageSize" @change="changePageSize">
            <option :value="10">10</option>
            <option :value="20">20</option>
            <option :value="50">50</option>
            <option :value="100">100</option>
          </select>
          条
        </label>
      </div>
      <table class="data-table detail-table">
        <thead>
          <tr><th>原因</th><th>接口路径</th><th>缓存键</th><th>状态码</th><th>存储</th><th>大小</th><th>抓取时间</th><th>内容摘要</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="s in samples" :key="s.id">
            <td><span class="reason-tag" :class="'r-' + s.reason">{{ reasonLabel(s.reason) }}</span></td>
            <td class="mono">{{ s.api_path }}</td>
            <td class="mono ellipsis" :title="s.cache_key">{{ s.cache_key }}</td>
            <td>{{ s.status_code }}</td>
            <td>{{ s.storage_mode }}</td>
            <td>{{ fmtSize(s.body_size) }}</td>
            <td>{{ fmt(s.fetched_at) }}</td>
            <td class="mono ellipsis snippet" :title="s.body_snippet">{{ s.body_snippet || '(空)' }}</td>
            <td><button class="link" @click="viewDetail(s.id)">详情</button></td>
          </tr>
        </tbody>
      </table>
      <!-- 分页（调后端重扫） -->
      <div class="pager" v-if="totalPages > 1">
        <button class="btn" :disabled="detailPage <= 1 || scanning" @click="gotoPage(detailPage - 1)">上一页</button>
        <span class="pager-info">{{ detailPage }} / {{ totalPages }}</span>
        <button class="btn" :disabled="detailPage >= totalPages || scanning" @click="gotoPage(detailPage + 1)">下一页</button>
      </div>
    </div>
    </template>

    <!-- 清理结果（两个 tab 共用） -->
    <div v-if="lastResult" class="panel">
      <h2 class="panel-title">上次操作结果</h2>
      <pre class="result">{{ lastResult }}</pre>
    </div>

    <!-- 脏数据详情弹窗：查看完整缓存内容（复用 /cache/responses/{id}） -->
    <div v-if="detailVisible" class="modal-mask" @click.self="detailVisible = false">
      <div class="modal">
        <div class="modal-head">
          <h3>脏缓存详情</h3>
          <button class="modal-close" @click="detailVisible = false">✕</button>
        </div>
        <div class="modal-body">
          <div v-if="detailLoading" class="empty">加载中...</div>
          <template v-else-if="detail">
            <div class="kv"><span>cache_key</span><b class="mono">{{ detail.cache_key }}</b></div>
            <div class="kv"><span>接口</span><b class="mono">{{ detail.method }} {{ detail.api_path }}</b></div>
            <div class="kv"><span>状态 / 存储</span><b>{{ detail.status_code }} / {{ detail.storage_mode }}</b></div>
            <div class="kv"><span>大小</span><b>{{ fmtSize(detail.body_size) }}</b></div>
            <div class="kv"><span>获取时间</span><b>{{ fmt(detail.fetched_at) }}</b></div>
            <div class="kv"><span>过期时间</span><b>{{ fmt(detail.expire_at) }}</b></div>
            <div class="body-label">完整响应内容：</div>
            <pre class="result body-pre">{{ prettyBody }}</pre>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'Cleanup',
  setup() {
    const activeTab = ref('table')      // table=数据表清理 / clean=数据清洗
    const policies = ref([])
    const schedule = ref({ enabled: true, interval_seconds: 3600 })
    const intervalMin = ref(60)
    const msg = ref('')
    const running = ref(false)
    const purging = ref(false)
    const scanning = ref(false)
    const scanResult = ref('')
    // 脏缓存清理筛选条件
    const dirty = ref({ api_path_prefix: '', older_than_days: 0, reasons: [] })
    const lastResult = ref('')
    // 扫描明细（后端分页）
    const samples = ref([])             // 当前页脏条目明细
    const byReason = ref({})            // 各原因计数（全量）
    const dirtyTotal = ref(0)           // 脏数据总数（全量）
    const detailFilter = ref('all')     // 明细按原因筛选（下推后端重扫）
    const detailPage = ref(1)           // 当前页码
    const totalPages = ref(1)           // 后端返回的总页数
    const pageSize = ref(20)            // 每页条数（前端可选，传给后端）
    const scanToken = ref('')           // 扫描结果令牌，翻页用（避免重复全表扫描）
    // 详情弹窗
    const detailVisible = ref(false)
    const detail = ref(null)
    const detailLoading = ref(false)

    const load = async () => {
      try {
        const res = await apiV2('/cleanup/policies')
        policies.value = res.data.policies || []
        schedule.value = res.data.schedule || { enabled: true, interval_seconds: 3600 }
        intervalMin.value = Math.round((schedule.value.interval_seconds || 3600) / 60)
      } catch (e) { msg.value = e.message }
    }

    const savePolicy = async (p) => {
      try {
        await apiV2(`/cleanup/policies/${p.table_key}`, {
          method: 'PUT',
          body: { enabled: p.enabled, retention_days: p.retention_days },
        })
        msg.value = `已更新 ${p.display_name}`
      } catch (e) { msg.value = e.message; load() }
    }

    const saveSchedule = async () => {
      try {
        await apiV2('/cleanup/schedule', {
          method: 'PUT',
          body: { enabled: schedule.value.enabled, interval_seconds: intervalMin.value * 60 },
        })
        msg.value = '定时配置已更新'
      } catch (e) { msg.value = e.message }
    }

    const doRun = async (keys) => {
      running.value = true
      msg.value = ''
      try {
        const res = await apiV2('/cleanup/run', { method: 'POST', body: { table_keys: keys } })
        lastResult.value = JSON.stringify(res.data, null, 2)
        msg.value = '清理完成'
        await load()
      } catch (e) { msg.value = e.message } finally { running.value = false }
    }
    const runAll = () => doRun(null)
    const runOne = (p) => doRun([p.table_key])

    // 构造脏缓存清理请求体（清理时用顶部勾选的脏类型）
    const dirtyBody = (extra = {}) => ({
      api_path_prefix: dirty.value.api_path_prefix || null,
      older_than_days: dirty.value.older_than_days || 0,
      reasons: dirty.value.reasons.length ? dirty.value.reasons : null,
      ...extra,
    })

    // 应用某页数据到视图
    const applyPage = (d) => {
      samples.value = d.samples || []
      byReason.value = d.by_reason || {}
      dirtyTotal.value = d.dirty_total || 0
      detailPage.value = d.page || 1
      totalPages.value = d.total_pages || 1
    }

    // 脏缓存预览：全表扫一次，拿 scan_token，后续翻页只切片不重扫
    const scanDirty = async () => {
      scanning.value = true
      scanResult.value = ''
      msg.value = ''
      detailFilter.value = 'all'
      detailPage.value = 1
      try {
        const res = await apiV2('/cleanup/scan-dirty-cache', {
          method: 'POST',
          body: dirtyBody({ page: 1, page_size: pageSize.value }),
        })
        scanResult.value = res.message || ''
        const d = res.data || {}
        scanToken.value = d.scan_token || ''
        applyPage(d)
        lastResult.value = JSON.stringify(
          { scanned: d.scanned, dirty_total: d.dirty_total, by_reason: d.by_reason }, null, 2)
      } catch (e) { msg.value = e.message } finally { scanning.value = false }
    }

    // 翻页 / 筛选 / 改每页条数：走缓存切片接口，毫秒级返回
    const loadDirtyPage = async (page) => {
      if (!scanToken.value) return
      scanning.value = true
      try {
        const res = await apiV2('/cleanup/dirty-cache-page', {
          method: 'POST',
          body: {
            scan_token: scanToken.value,
            page,
            page_size: pageSize.value,
            reason: detailFilter.value,
          },
        })
        if (res.success === false) {
          // 扫描结果过期，提示重新扫描
          msg.value = res.message || '扫描结果已过期，请重新扫描'
          scanToken.value = ''
          return
        }
        applyPage(res.data || {})
      } catch (e) { msg.value = e.message } finally { scanning.value = false }
    }

    // 翻页：保留筛选，仅换页（切片）
    const gotoPage = (p) => {
      if (p < 1 || p > totalPages.value) return
      loadDirtyPage(p)
    }
    // 切换每页条数：回到第 1 页
    const changePageSize = () => loadDirtyPage(1)
    // 点原因 chip：按该原因从缓存切片，回到第 1 页
    const setDetailFilter = (r) => {
      detailFilter.value = r
      loadDirtyPage(1)
    }

    // 脏缓存清理：按当前筛选执行删除
    const purgeDirty = async () => {
      purging.value = true
      msg.value = ''
      try {
        const res = await apiV2('/cleanup/purge-dirty-cache', { method: 'POST', body: dirtyBody() })
        lastResult.value = JSON.stringify(res.data, null, 2)
        msg.value = res.message || '脏缓存清理完成'
        scanResult.value = ''
        samples.value = []
        dirtyTotal.value = 0
        totalPages.value = 1
        scanToken.value = ''
        await load()
      } catch (e) { msg.value = e.message } finally { purging.value = false }
    }

    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')
    const fmtSize = (n) => {
      if (!n) return '0 B'
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
      return (n / 1024 / 1024).toFixed(1) + ' MB'
    }
    const reasonLabel = (r) => ({ empty: '空结果', fail: 'success:false', error_code: 'errorCode≠0' }[r] || r)

    // 查看脏缓存完整内容（复用响应缓存详情接口，id 即 ApiResponseCache.id）
    const viewDetail = async (id) => {
      detailVisible.value = true
      detailLoading.value = true
      detail.value = null
      try {
        const res = await apiV2(`/cache/responses/${id}`)
        detail.value = res.data
      } catch (e) { msg.value = e.message; detailVisible.value = false }
      finally { detailLoading.value = false }
    }
    // body 美化：能解析 JSON 则缩进展示，否则原样
    const prettyBody = computed(() => {
      if (!detail.value || !detail.value.body) return '（空）'
      try { return JSON.stringify(JSON.parse(detail.value.body), null, 2) }
      catch { return detail.value.body }
    })

    onMounted(load)
    return { activeTab, policies, schedule, intervalMin, msg, running, purging, scanning,
      scanResult, dirty, lastResult,
      samples, byReason, dirtyTotal,
      detailFilter, detailPage, pageSize, totalPages,
      detailVisible, detail, detailLoading, prettyBody, viewDetail,
      savePolicy, saveSchedule, runAll, runOne, scanDirty, purgeDirty,
      gotoPage, changePageSize, setDetailFilter,
      fmt, fmtSize, reasonLabel }
  },
}
</script>

<style scoped>
.page { padding: 24px; }
.page-title { font-size: 22px; margin-bottom: 20px; color: #333; }
.msg { color: #1677ff; margin-bottom: 12px; }
.panel { background: #fff; border-radius: 10px; padding: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); margin-bottom: 18px; }
.panel-title { font-size: 16px; margin-bottom: 14px; color: #333; }
.sched-row { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
.switch { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.interval { display: flex; align-items: center; gap: 8px; color: #555; }
.num { width: 80px; padding: 5px 8px; border: 1px solid #d9d9d9; border-radius: 6px; text-align: center; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
.data-table th { color: #888; font-weight: 500; }
.sensitive { background: #fff7f6; }
.badge-warn { background: #fff1f0; color: #cf1322; border: 1px solid #ffa39e; border-radius: 4px; padding: 0 6px; font-size: 11px; margin-left: 6px; }
.btn { padding: 6px 14px; border: 1px solid #d9d9d9; background: #fff; border-radius: 6px; cursor: pointer; font-size: 13px; }
.btn-primary { background: #1677ff; color: #fff; border-color: #1677ff; }
.btn-danger { background: #ff4d4f; color: #fff; border-color: #ff4d4f; }
.purge-desc { flex: 1; min-width: 280px; color: #555; font-size: 13px; line-height: 1.6; }
.purge-desc b { color: #cf1322; }
.filter-grid { display: flex; gap: 20px; flex-wrap: wrap; margin: 14px 0; }
.filter-item { display: flex; flex-direction: column; gap: 6px; }
.filter-item label { font-size: 12px; color: #888; }
.filter-item .input { padding: 6px 10px; border: 1px solid #d9d9d9; border-radius: 6px; min-width: 240px; font-size: 13px; }
.checks { display: flex; gap: 14px; align-items: center; }
.checks label { display: flex; align-items: center; gap: 4px; font-size: 13px; color: #555; cursor: pointer; }
.purge-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.scan-result { color: #1677ff; font-size: 13px; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.link { color: #1677ff; background: none; border: none; cursor: pointer; font-size: 13px; }
.link:disabled { opacity: .5; cursor: not-allowed; }
.tip { color: #999; font-size: 12px; margin-top: 10px; }
.result { background: #f6f8fa; padding: 12px; border-radius: 6px; font-size: 12px; overflow: auto; }
/* Tab 切换 */
.tabs { display: flex; gap: 8px; margin-bottom: 18px; border-bottom: 1px solid #eee; }
.tab { padding: 10px 20px; border: none; background: none; cursor: pointer; font-size: 14px; color: #888; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.tab.active { color: #1677ff; border-bottom-color: #1677ff; font-weight: 500; }
/* 明细表 */
.detail-sub { font-size: 12px; color: #999; font-weight: normal; margin-left: 8px; }
.detail-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.detail-filter { display: flex; gap: 8px; flex-wrap: wrap; }
.page-size { font-size: 13px; color: #555; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.page-size select { padding: 4px 8px; border: 1px solid #d9d9d9; border-radius: 6px; }
.chip { padding: 4px 12px; border: 1px solid #d9d9d9; background: #fff; border-radius: 14px; cursor: pointer; font-size: 12px; color: #555; }
.chip.on { background: #1677ff; color: #fff; border-color: #1677ff; }
.detail-table td { font-size: 12px; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
.ellipsis { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.snippet { max-width: 280px; color: #666; }
.reason-tag { padding: 1px 8px; border-radius: 4px; font-size: 11px; white-space: nowrap; }
.r-empty { background: #fff7e6; color: #d46b08; }
.r-fail { background: #fff1f0; color: #cf1322; }
.r-error_code { background: #f9f0ff; color: #531dab; }
.pager { display: flex; align-items: center; gap: 12px; margin-top: 14px; justify-content: center; }
.pager-info { font-size: 13px; color: #888; }
/* 详情弹窗 */
.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { background: #fff; border-radius: 10px; width: 720px; max-width: 92vw; max-height: 85vh; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
.modal-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid #f0f0f0; }
.modal-head h3 { font-size: 16px; color: #333; margin: 0; }
.modal-close { border: none; background: none; font-size: 16px; color: #999; cursor: pointer; }
.modal-body { padding: 16px 20px; overflow: auto; }
.kv { display: flex; gap: 12px; padding: 5px 0; font-size: 13px; border-bottom: 1px dashed #f0f0f0; }
.kv span { color: #888; min-width: 88px; }
.kv b { color: #333; font-weight: 500; word-break: break-all; }
.body-label { margin: 14px 0 6px; font-size: 13px; color: #555; }
.body-pre { max-height: 360px; }
</style>
