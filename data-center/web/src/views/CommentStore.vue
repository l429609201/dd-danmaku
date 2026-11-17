<template>
  <div class="page">
    <h1 class="page-title">弹幕存储</h1>
    <p v-if="msg" class="msg">{{ msg }}</p>
    <!-- Rust 的规范化数据库与旧 JSON 存储能力不同，不将未知配额或 R2 配置显示为已配置。 -->
    <p class="tip">{{ stats?.storage_note || '当前 Rust 后端未实现容量配置、LRU 清理与全部清空；这些操作保留入口但不可执行。' }}</p>

    <!-- 统计概览 -->
    <div class="cards" v-if="stats">
      <div class="card">
        <div class="card-label">弹幕集数</div>
        <div class="card-value">{{ stats.file_count }}</div>
      </div>
      <div class="card">
        <div class="card-label">总大小</div>
        <div class="card-value">{{ fmtBytes(stats.total_size_bytes) }}</div>
      </div>
      <div class="card">
        <div class="card-label">总弹幕条数</div>
        <div class="card-value">{{ (stats.total_comments || 0).toLocaleString() }}</div>
      </div>
      <div class="card" :class="stats.usage_ratio > 90 ? 'card-warn' : 'card-accent'">
        <div class="card-label">容量占用</div>
        <div class="card-value">{{ stats.usage_ratio == null ? '未知' : stats.usage_ratio + '%' }}</div>
        <div class="card-sub">上限 {{ stats.max_bytes == null ? '未实现配额' : fmtBytes(stats.max_bytes) }}</div>
      </div>
    </div>

    <!-- 配置与操作 -->
    <div class="panel">
      <h2 class="panel-title">存储配置</h2>
      <div class="cfg-row">
        <label class="cfg-item perm">
          <input type="checkbox" v-model="unlimited" :disabled="!supports('quota')" @change="saveUnlimited" />
          永久保存（关闭容量淘汰，弹幕只增不删）
        </label>
      </div>
      <div class="cfg-row">
        <div class="cfg-item">
          存储上限
          <input type="number" min="0" step="0.5" v-model.number="maxGb" class="num" :disabled="unlimited || !supports('quota')" />
          GB
          <button class="btn btn-primary" @click="saveMax" :disabled="busy || unlimited || !supports('quota')">保存上限</button>
        </div>
        <button class="btn" :disabled="busy || unlimited || !supports('cleanup')" @click="doCleanup">手动 LRU 清理</button>
        <button class="btn btn-danger" :disabled="busy || !supports('clear_all')" @click="doClearAll" :title="'当前 Rust 后端未实现全部清空'">清空全部</button>
      </div>
      <p class="tip" v-if="unlimited">⚠️ 已开启永久保存：弹幕不会被自动清理，请关注磁盘占用（目录：{{ stats ? stats.dir : '—' }}）。</p>
      <p class="tip" v-else>未配置容量管理。弹幕大小仅为已知元数据，规范化数据库未核算物理大小。</p>
    </div>

    <!-- 只有后端明确报告 Worker 模式才显示 R2；未知模式默认隐藏。 -->
    <div v-if="isWorkerMode" class="panel">
      <h2 class="panel-title">R2 缓存控制</h2>
      <div class="cfg-row">
        <label class="cfg-item switch-item">
          <input type="checkbox" v-model="r2WriteEnabled" :disabled="!supports('r2')" />
          允许写入 R2
        </label>
        <label class="cfg-item switch-item danger-switch">
          <input type="checkbox" v-model="r2DeleteEnabled" :disabled="!supports('r2')" />
          允许自动删除 R2
        </label>
        <button class="btn btn-primary" :disabled="busy || !supports('r2')" @click="saveR2Control">保存并下发</button>
      </div>
      <p v-if="!supports('r2')" class="tip">当前 Rust 后端尚未实现 R2 管理，以上操作不可执行。</p>
      <p v-else class="tip">关闭 R2 写入后，本地端仍会持续归档弹幕；关闭自动删除后，过期与容量清理均停止。</p>

      <div class="r2-summary" v-if="r2Task">
        <div><b>{{ r2Task.objects || 0 }}</b><span>R2 对象</span></div>
        <div><b>{{ fmtBytes(r2Task.total_bytes) }}</b><span>扫描大小</span></div>
        <div><b>{{ r2Task.saved || 0 }}</b><span>已存本地</span></div>
        <div><b>{{ r2Task.errors || 0 }}</b><span>失败</span></div>
      </div>
      <div class="cfg-row">
        <button class="btn" :disabled="!supports('r2') || (r2Task && r2Task.running)" @click="startR2Task('scan')">扫描 R2 存量</button>
        <button class="btn btn-primary" :disabled="!supports('r2') || (r2Task && r2Task.running)" @click="startR2Task('sync')">同步全部到本地</button>
        <span class="task-status" v-if="r2Task">{{ r2Task.message }}</span>
      </div>
      <div class="progress" v-if="r2Task && r2Task.running">
        <div class="progress-bar" :style="{ width: r2Progress + '%' }"></div>
      </div>
      <p class="tip" v-if="r2Task && r2Task.mode === 'sync'">
        已处理 {{ r2Task.processed || 0 }} / {{ r2Task.objects || 0 }}；跳过 {{ r2Task.skipped || 0 }}；当前 {{ r2Task.current_episode_id || '—' }}。同步仅复制，不删除 R2。
      </p>
    </div>

    <!-- 条目列表 -->
    <div class="panel">
      <div class="list-head">
        <h2 class="panel-title">弹幕条目</h2>
        <div class="search">
          <select v-model="sort" class="input" @change="reload">
            <option value="created_at">按存入时间</option>
            <option value="last_used_at">按最近使用</option>
            <option value="comment_count">按弹幕数</option>
            <option value="size_bytes">按大小</option>
          </select>
          <input v-model="keyword" class="input" placeholder="按 episode_id 搜索" @keyup.enter="reload" />
          <button class="btn" @click="reload">搜索</button>
        </div>
      </div>
      <table class="data-table">
        <thead>
          <tr><th>episode_id</th><th>弹幕数</th><th>大小</th><th>来源</th><th>存入时间</th><th>最后使用</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in items" :key="r.id">
            <td>{{ r.episode_id }}</td>
            <td>{{ (r.comment_count || 0).toLocaleString() }}</td>
            <td>{{ fmtBytes(r.size_bytes) }}</td>
            <td>{{ r.source }}</td>
            <td>{{ fmt(r.created_at) }}</td>
            <td>{{ fmt(r.last_used_at) }}</td>
            <td>
              <button class="link" @click="view(r)">查看</button>
              <button class="link danger" :disabled="!r.deletable" :title="r.delete_reason" @click="del(r)">删除</button>
            </td>
          </tr>
          <tr v-if="!items.length"><td colspan="7" class="empty">暂无弹幕缓存</td></tr>
        </tbody>
      </table>
      <Pager :page="page" :page-size="pageSize" :total="total" @update:page="goPage" />
    </div>

    <!-- 弹幕详情弹窗 -->
    <div v-if="detail" class="modal-mask" @click.self="detail=null">
      <div class="modal">
        <div class="modal-head">
          <h3>弹幕详情：{{ detail.episode_id }}</h3>
          <button class="modal-close" @click="detail=null">×</button>
        </div>
        <div class="detail-meta">
          <span>弹幕数 <b>{{ (detail.comment_count || 0).toLocaleString() }}</b></span>
          <span>大小 <b>{{ fmtBytes(detail.size_bytes) }}</b></span>
          <span>来源 <b>{{ detail.source }}</b></span>
          <span>存入 <b>{{ fmt(detail.created_at) }}</b></span>
          <span>最后使用 <b>{{ fmt(detail.last_used_at) }}</b></span>
        </div>
        <p v-if="!canPreview(detail)" class="warn-text">旧 JSON 归档仅展示元数据；当前不读取归档文件，未核验文件是否存在</p>
        <p class="preview-tip" v-else>弹幕内容（已加载 {{ preview.length }} / {{ detail.preview_total }} 条）：</p>
        <div class="preview-box" v-if="canPreview(detail)" ref="previewBox" @scroll="onPreviewScroll">
          <div v-for="(c, i) in preview" :key="i" class="cmt">
            <span class="cmt-time">{{ cmtTime(c) }}</span>
            <span class="cmt-text">{{ cmtText(c) }}</span>
          </div>
          <div v-if="!preview.length" class="empty">无可解析的弹幕</div>
          <div v-if="loadingMore" class="loading-more">加载中...</div>
          <div v-else-if="!hasMore && preview.length" class="loading-more">— 已全部加载 —</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { apiV2 } from '../utils/api.js'
import Pager from '../components/Pager.vue'
import { getCacheConfig } from '../api/system.js'

export default {
  name: 'CommentStore',
  components: { Pager },
  setup() {
    // 模式只取自已认证的运行配置；请求失败时保持未知，不能默认 Worker。
    const runMode = ref(null)
    const isWorkerMode = computed(() => runMode.value === 'worker')
    const stats = ref(null)
    const items = ref([])
    const total = ref(0)
    const page = ref(1)
    const pageSize = ref(20)
    const keyword = ref('')
    const sort = ref('created_at')
    const maxGb = ref(5)
    const unlimited = ref(false)
    const r2WriteEnabled = ref(false)
    const r2DeleteEnabled = ref(false)
    const r2Task = ref(null)
    const msg = ref('')
    const busy = ref(false)
    const detail = ref(null)
    // 详情弹窗滚动加载状态
    const preview = ref([])
    const previewBox = ref(null)
    const loadingMore = ref(false)
    const hasMore = ref(false)
    const PREVIEW_PAGE = 100
    let r2Timer = null
    const r2Progress = computed(() => {
      if (!r2Task.value || !r2Task.value.objects) return 0
      return Math.min(100, Math.round((r2Task.value.processed || 0) / r2Task.value.objects * 100))
    })

    // 能力由后端明确声明；缺省不允许执行破坏性或尚未实现的操作。
    const supports = (feature) => (feature !== 'r2' || isWorkerMode.value) && stats.value?.capabilities?.[feature] === true
    const canPreview = (row) => row.preview_available ?? row.file_exists
    const requireCapability = (feature) => {
      if (!supports(feature)) { msg.value = '当前 Rust 后端尚未实现此操作，未发送请求'; return false }
      return true
    }
    const loadStats = async () => {
      try {
        const res = await apiV2('/comment-store/stats')
        stats.value = res.data
        maxGb.value = res.data.max_bytes == null ? null : Math.round((res.data.max_bytes / 1024 / 1024 / 1024) * 10) / 10
        unlimited.value = !!res.data.unlimited
        const ctl = res.data.r2_control || {}
        r2WriteEnabled.value = ctl.write_enabled === true
        r2DeleteEnabled.value = ctl.delete_enabled === true
        r2Task.value = supports('r2') ? res.data.r2_task || null : null
        if (!supports('r2') && r2Timer) { clearInterval(r2Timer); r2Timer = null }
        // 页面刷新后若后台任务仍在运行，恢复进度轮询。
        if (supports('r2') && r2Task.value && r2Task.value.running && !r2Timer) {
          r2Timer = setInterval(pollR2Task, 1000)
        }
      } catch (e) { msg.value = e.message }
    }
    const load = async () => {
      try {
        const res = await apiV2(`/comment-store/entries?page=${page.value}&page_size=${pageSize.value}&sort=${sort.value}&keyword=${encodeURIComponent(keyword.value)}`)
        items.value = res.items || []
        total.value = res.total || 0
      } catch (e) { msg.value = e.message }
    }
    const reload = () => { page.value = 1; load() }
    const goPage = (p) => { page.value = p; load() }

    const saveMax = async () => {
      if (!requireCapability('quota')) return
      try {
        await apiV2('/comment-store/max-bytes', { method: 'PUT', body: { max_gb: maxGb.value } })
        msg.value = '上限已更新'; loadStats()
      } catch (e) { msg.value = e.message }
    }
    const saveUnlimited = async () => {
      if (!requireCapability('quota')) return
      try {
        await apiV2('/comment-store/unlimited', { method: 'PUT', body: { unlimited: unlimited.value } })
        msg.value = unlimited.value ? '已开启永久保存' : '已关闭永久保存'
        loadStats()
      } catch (e) { msg.value = e.message; unlimited.value = !unlimited.value /* 失败回滚 */ }
    }
    const saveR2Control = async () => {
      if (!requireCapability('r2')) return
      busy.value = true
      try {
        const res = await apiV2('/comment-store/r2-control', {
          method: 'PUT',
          body: { write_enabled: r2WriteEnabled.value, delete_enabled: r2DeleteEnabled.value },
        })
        msg.value = res.message
      } catch (e) { msg.value = e.message } finally { busy.value = false }
    }
    const pollR2Task = async () => {
      // 轮询与按钮共用模式/能力守卫，防止旧任务状态触发无效请求。
      if (!supports('r2')) {
        if (r2Timer) { clearInterval(r2Timer); r2Timer = null }
        return
      }
      try {
        const res = await apiV2('/comment-store/r2-task')
        r2Task.value = res.data
        if (res.data && !res.data.running && r2Timer) {
          clearInterval(r2Timer); r2Timer = null
          loadStats(); load()
        }
      } catch (e) { msg.value = e.message }
    }
    const startR2Task = async (mode) => {
      if (!requireCapability('r2')) return
      try {
        const res = await apiV2(`/comment-store/r2-${mode}`, { method: 'POST' })
        msg.value = res.message
        r2Task.value = res.data
        if (res.success && !r2Timer) r2Timer = setInterval(pollR2Task, 1000)
      } catch (e) { msg.value = e.message }
    }
    const doCleanup = async () => {
      if (!requireCapability('cleanup')) return
      busy.value = true
      try {
        const res = await apiV2('/comment-store/cleanup', { method: 'POST' })
        msg.value = res.message; loadStats(); load()
      } catch (e) { msg.value = e.message } finally { busy.value = false }
    }
    const doClearAll = async () => {
      if (!requireCapability('clear_all')) return
      if (!confirm('确认清空全部弹幕缓存？此操作不可恢复')) return
      busy.value = true
      try {
        const res = await apiV2('/comment-store/all', { method: 'DELETE' })
        msg.value = res.message; loadStats(); reload()
      } catch (e) { msg.value = e.message } finally { busy.value = false }
    }
    const del = async (r) => {
      if (!r.deletable) { msg.value = r.delete_reason || '此存储类型不支持删除'; return }
      if (!confirm(`删除 ${r.episode_id} 的弹幕？`)) return
      try {
        await apiV2(`/comment-store/entries/${encodeURIComponent(r.episode_id)}`, { method: 'DELETE' })
        msg.value = '已删除'; loadStats(); load()
      } catch (e) { msg.value = e.message }
    }
    // 查看弹幕详情（首屏）
    const view = async (r) => {
      try {
        preview.value = []
        const res = await apiV2(`/comment-store/entries/${encodeURIComponent(r.episode_id)}?offset=0&limit=${PREVIEW_PAGE}`)
        detail.value = res.data
        preview.value = (res.data && res.data.preview) || []
        hasMore.value = !!(res.data && res.data.has_more)
      } catch (e) { msg.value = e.message }
    }
    // 滚动到底部时加载下一批弹幕
    const loadMorePreview = async () => {
      if (loadingMore.value || !hasMore.value || !detail.value) return
      loadingMore.value = true
      try {
        const res = await apiV2(`/comment-store/entries/${encodeURIComponent(detail.value.episode_id)}?offset=${preview.value.length}&limit=${PREVIEW_PAGE}`)
        const more = (res.data && res.data.preview) || []
        preview.value = preview.value.concat(more)
        hasMore.value = !!(res.data && res.data.has_more)
      } catch (e) { msg.value = e.message } finally { loadingMore.value = false }
    }
    const onPreviewScroll = (e) => {
      const el = e.target
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) loadMorePreview()
    }
    // 解析弹幕字段：dandanplay 格式 { p: "时间,模式,颜色,uid", m: "文本" }
    const cmtTime = (c) => {
      const p = (c && c.p) ? String(c.p).split(',')[0] : ''
      const t = parseFloat(p)
      if (isNaN(t)) return '—'
      const m = Math.floor(t / 60), s = Math.floor(t % 60)
      return `${m}:${s.toString().padStart(2, '0')}`
    }
    const cmtText = (c) => (c && (c.m || c.text)) || ''

    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')
    const fmtBytes = (n) => {
      if (n == null) return '未知'
      n = Number(n) || 0
      if (n < 1024) return n + ' B'
      if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'
      if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB'
      return (n / 1073741824).toFixed(2) + ' GB'
    }

    onMounted(async () => {
      // 先确认运行模式，再决定是否恢复 R2 任务；本地列表不依赖模式请求成功。
      try { runMode.value = (await getCacheConfig()).run_mode } catch { runMode.value = null }
      loadStats(); load()
    })
    onUnmounted(() => { if (r2Timer) clearInterval(r2Timer) })
    return { isWorkerMode, stats, items, total, page, pageSize, keyword, sort, maxGb, unlimited, msg, busy, detail,
      r2WriteEnabled, r2DeleteEnabled, r2Task, r2Progress,
      preview, previewBox, loadingMore, hasMore, startR2Task, saveR2Control,
      reload, goPage, saveMax, saveUnlimited, doCleanup, doClearAll, del, view, onPreviewScroll,
      cmtTime, cmtText, fmt, fmtBytes, supports, canPreview }
  },
}
</script>

<style scoped>
.page { padding: 24px; }
.page-title { font-size: 22px; margin-bottom: 20px; color: #333; }
.msg { color: #1677ff; margin-bottom: 12px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; margin-bottom: 18px; }
.card { background: #fff; border-radius: 10px; padding: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
.card-accent { border-left: 4px solid #1677ff; }
.card-warn { border-left: 4px solid #faad14; }
.card-label { color: #888; font-size: 13px; margin-bottom: 8px; }
.card-value { font-size: 26px; font-weight: 600; color: #333; }
.card-sub { color: #999; font-size: 12px; margin-top: 4px; }
.panel { background: #fff; border-radius: 10px; padding: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); margin-bottom: 18px; }
.panel-title { font-size: 16px; margin-bottom: 14px; color: #333; }
.cfg-row { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; margin-bottom: 12px; }
.cfg-item { display: flex; align-items: center; gap: 8px; color: #555; }
.cfg-item.perm { cursor: pointer; font-weight: 500; color: #d46b08; }
.cfg-item.perm input { width: 16px; height: 16px; cursor: pointer; }
.switch-item { cursor: pointer; font-weight: 500; }
.switch-item input { width: 16px; height: 16px; cursor: pointer; }
.danger-switch { color: #d46b08; }
.r2-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin: 14px 0; }
.r2-summary div { padding: 12px; border-radius: 8px; background: #f7f9fc; }
.r2-summary b { display: block; font-size: 20px; color: #333; }
.r2-summary span, .task-status { font-size: 12px; color: #888; }
.progress { height: 8px; background: #eef1f5; border-radius: 4px; overflow: hidden; margin: 8px 0; }
.progress-bar { height: 100%; background: #1677ff; transition: width .25s ease; }
.list-head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
.search { display: flex; gap: 8px; }
.num { width: 80px; padding: 5px 8px; border: 1px solid #d9d9d9; border-radius: 6px; text-align: center; }
.input { padding: 6px 10px; border: 1px solid #d9d9d9; border-radius: 6px; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
.data-table th { color: #888; font-weight: 500; }
.btn { padding: 6px 14px; border: 1px solid #d9d9d9; background: #fff; border-radius: 6px; cursor: pointer; font-size: 13px; }
.btn-primary { background: #1677ff; color: #fff; border-color: #1677ff; }
.btn-danger { background: #fff1f0; color: #cf1322; border-color: #ffa39e; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.link { color: #1677ff; background: none; border: none; cursor: pointer; font-size: 13px; }
.link.danger { color: #cf1322; }
.empty { text-align: center; color: #999; padding: 24px; }
.tip { color: #999; font-size: 12px; margin-top: 10px; }
.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { background: #fff; border-radius: 10px; padding: 20px; width: 600px; max-width: 92vw; max-height: 80vh; display: flex; flex-direction: column; }
.modal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.modal-head h3 { font-size: 16px; color: #333; margin: 0; word-break: break-all; }
.modal-close { background: none; border: none; font-size: 22px; cursor: pointer; color: #999; line-height: 1; }
.detail-meta { display: flex; flex-wrap: wrap; gap: 16px; font-size: 13px; color: #888; margin-bottom: 12px; }
.detail-meta b { color: #333; }
.warn-text { color: #cf1322; font-size: 13px; }
.preview-tip { color: #666; font-size: 13px; margin-bottom: 8px; }
.preview-box { overflow-y: auto; flex: 1; border: 1px solid #f0f0f0; border-radius: 6px; padding: 8px; }
.cmt { display: flex; gap: 10px; padding: 5px 6px; border-bottom: 1px solid #f7f7f7; font-size: 13px; }
.cmt-time { color: #1677ff; font-family: monospace; flex-shrink: 0; width: 56px; }
.cmt-text { color: #333; word-break: break-all; }
.loading-more { text-align: center; color: #999; font-size: 12px; padding: 10px; }
</style>
