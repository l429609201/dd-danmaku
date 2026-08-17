<template>
  <div class="app-page">
    <h1 class="app-page__title">Worker 日志</h1>

    <div class="app-toolbar">
      <el-select v-model="selectedFile" placeholder="当前日志文件" style="width: 320px"
                 popper-class="worker-log-file-popper" @change="reload">
        <el-option v-for="f in files" :key="f.name" :label="fileLabel(f)" :value="f.name">
          <div class="log-file-option">
            <div class="log-file-option__main">
              <span>{{ f.name }}</span>
              <span class="log-file-option__stats">{{ f.size_mb }} MB · {{ f.line_count || 0 }} 行</span>
            </div>
            <div class="log-file-option__range">{{ fileRange(f) }}</div>
          </div>
        </el-option>
      </el-select>
      <el-select v-model="level" placeholder="全部级别" clearable style="width: 130px" @change="reload">
        <el-option label="INFO" value="INFO" />
        <el-option label="WARN" value="WARN" />
        <el-option label="ERROR" value="ERROR" />
      </el-select>
      <el-input v-model="keyword" placeholder="关键词（跨字段搜）" clearable style="width: 200px" @keyup.enter="reload" @clear="reload" />
      <el-input v-model="ipSearch" placeholder="搜索 IP" clearable style="width: 160px" @keyup.enter="reload" @clear="reload" />
      <el-input v-model="uaSearch" placeholder="搜索 X-UA" clearable style="width: 170px" @keyup.enter="reload" @clear="reload" />
      <el-input v-model="userIdSearch" placeholder="搜索 用户ID" clearable style="width: 150px" @keyup.enter="reload" @clear="reload" />
      <el-button type="primary" :icon="Search" @click="reload">查询</el-button>
      <el-switch v-model="prettyJson" active-text="JSON格式化" style="margin-right: 16px" />
      <div class="app-toolbar__spacer" />
      <el-switch v-model="streaming" active-text="实时" @change="toggleStream" />
    </div>

    <el-card shadow="never">
      <el-table ref="tableRef" :data="items" size="small" v-loading="loading" empty-text="暂无日志"
                :row-class-name="rowClass"
                row-key="_uid"
                @expand-change="onExpand">
        <!-- 展开行：文件列表接口已随行返回请求体与响应体，无需二次请求。 -->
        <el-table-column type="expand">
          <template #default="{ row }">
            <div v-if="row._bodyLoading" class="body-empty">加载请求/响应体…</div>
            <div v-else class="body-expand">
              <!-- 搜索词：GET 请求的参数在 URL query 而非 body，单独展示便于排查 -->
              <div v-if="row.query" class="body-block">
                <span class="body-label">搜索词</span>
                <pre class="body-pre">{{ row.query }}</pre>
              </div>
              <div v-if="row.request_body" class="body-block">
                <span class="body-label">请求体</span>
                <pre class="body-pre" :key="(prettyJson ? 'p' : 'r') + '-req'">{{ renderBody(row.request_body) }}</pre>
              </div>
              <div v-if="row.response_body" class="body-block">
                <span class="body-label">响应体</span>
                <pre class="body-pre" :key="(prettyJson ? 'p' : 'r') + '-resp'">{{ renderBody(row.response_body) }}</pre>
              </div>
              <div v-if="!row.query && !row.request_body && !row.response_body" class="body-empty">
                该条日志无搜索词/请求体/响应体（拦截类早退路径）
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="180">
          <template #default="{ row }">{{ fmt(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="级别" width="90">
          <template #default="{ row }">
            <el-tag :type="levelType(row.level)" size="small">{{ row.level }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="worker_id" label="Worker" width="120">
          <template #default="{ row }">{{ row.worker_id || '—' }}</template>
        </el-table-column>
        <el-table-column label="IP" width="130">
          <template #default="{ row }"><span class="app-mono">{{ row.client_ip || '—' }}</span></template>
        </el-table-column>
        <el-table-column label="X-UA" width="140" show-overflow-tooltip>
          <template #default="{ row }"><span class="app-mono">{{ row.ua_type || '—' }}</span></template>
        </el-table-column>
        <el-table-column label="用户ID" width="120" show-overflow-tooltip>
          <template #default="{ row }"><span class="app-mono">{{ row.client_user_id || '—' }}</span></template>
        </el-table-column>
        <el-table-column prop="method" label="方法" width="80">
          <template #default="{ row }">{{ row.method || '—' }}</template>
        </el-table-column>
        <el-table-column label="路径" min-width="200">
          <template #default="{ row }"><span class="app-mono">{{ decodeText(row.path) }}</span></template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }">{{ row.status || '—' }}</template>
        </el-table-column>
        <el-table-column label="缓存来源" width="130">
          <template #default="{ row }">
            <el-tag v-if="row.cache_source" :type="sourceType(row.cache_source)" size="small">{{ sourceLabel(row.cache_source) }}</el-tag>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="耗时" width="80">
          <template #default="{ row }">{{ row.duration_ms != null ? row.duration_ms + 'ms' : '—' }}</template>
        </el-table-column>
        <el-table-column label="字节" width="90">
          <template #default="{ row }">{{ fmtBytes(row.response_bytes) }}</template>
        </el-table-column>
        <el-table-column label="密钥" width="100">
          <template #default="{ row }"><span class="app-mono">{{ row.key_id || '—' }}</span></template>
        </el-table-column>
        <el-table-column prop="message" label="消息" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.message || '—' }}</template>
        </el-table-column>
      </el-table>
      <!-- 无限滚动状态提示：实时模式下不显示（实时流自动追加） -->
      <div v-if="!streaming && items.length" class="load-more-hint">
        <span v-if="loadingMore">加载中…</span>
        <span v-else-if="!hasMore">— 没有更多了 —</span>
        <span v-else class="load-more-tip">下滑加载更多</span>
      </div>
    </el-card>
  </div>
</template>

<script>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { apiV2, getAuthHeaders } from '../utils/api.js'

export default {
  name: 'WorkerLogs',
  setup() {
    const tableRef = ref(null)     // el-table 组件引用
    const items = ref([])
    const files = ref([])          // 轮转文件列表
    const selectedFile = ref('')   // 当前选中的文件（空=当前 worker.log）
    const level = ref('')
    const keyword = ref('')
    const ipSearch = ref('')       // 按客户端 IP 搜索
    const uaSearch = ref('')       // 按 X-UA（X-User-Agent）搜索
    const userIdSearch = ref('')   // 按客户端用户标识（X-Ddd-User）搜索
    const loading = ref(false)
    const loadingMore = ref(false) // 无限滚动加载中标记，防止重复触发
    const streaming = ref(false)
    const expandedRows = ref([])
    const prettyJson = ref(true)  // JSON 格式化开关，默认开启
    const PAGE_SIZE = 50
    const page = ref(1)            // 当前已加载页码
    const hasMore = ref(true)      // 是否还有下一页
    const totalEstimated = ref(false) // total 是否为估算值（文件扫描被截断）
    let abortCtrl = null

    // 加载轮转文件列表
    const loadFiles = async () => {
      try {
        const res = await apiV2('/worker-logs/files')
        files.value = res.data?.files || []
        // 默认选中当前文件
        if (files.value.length > 0 && !selectedFile.value) {
          selectedFile.value = files.value[0].name
        }
      } catch (e) {
        ElMessage.warning('文件列表加载失败: ' + e.message)
      }
    }

    // 统一拉取某一页，append=false 时替换（首次/查询），true 时追加（滚动加载）
    const fetchPage = async (targetPage, append) => {
      const q = new URLSearchParams({ page: targetPage, page_size: PAGE_SIZE })
      // 新接口：日志在轮转文件里，selectedFile 指定查哪个文件
      if (selectedFile.value) q.set('file', selectedFile.value)
      if (level.value) q.set('level', level.value)
      if (keyword.value) q.set('keyword', keyword.value)
      if (ipSearch.value) q.set('ip', ipSearch.value)
      if (uaSearch.value) q.set('ua', uaSearch.value)
      if (userIdSearch.value) q.set('user_id', userIdSearch.value)
      const res = await apiV2(`/worker-logs?${q.toString()}`)
      // total_estimated=true 时显示「约 N 条」
      totalEstimated.value = res.total_estimated || false
      // 每条加唯一 _uid，防止 el-table row-key 因 id 缺失把全部行当同一行；
      // 文件里的日志没有数据库 id，用时间戳+随机数生成
      const mapped = (res.items || []).map((item, idx) => ({
        ...item,
        _uid: item.id ? `db-${item.id}` : `f-${targetPage}-${idx}-${Date.now()}`,
        // body 已随列表返回，标记已加载
        _bodyLoaded: true,
      }))
      items.value = append ? items.value.concat(mapped) : mapped
      page.value = targetPage
      // 本页数量不足 PAGE_SIZE 说明已到末页
      hasMore.value = mapped.length >= PAGE_SIZE
    }

    // 展开行：body 已随列表返回（文件存储无列宽限制），不再按需加载。
    // 保留空函数以免模板报错，实际不做任何操作。
    const onExpand = async () => {
      // 旧逻辑已废弃：body 在 fetchPage 时已标记 _bodyLoaded=true
    }

    // 安全 URL 解码：path/cache_key 里的中文被 Worker encodeURIComponent 编码过，
    // 展示时解码成可读文本；非法编码序列会抛异常，此时回退原值。
    const decodeText = (s) => {
      if (!s) return '—'
      try { return decodeURIComponent(String(s)) } catch (_) { return String(s) }
    }

    // 查询/刷新：重置到第一页
    const reload = async () => {
      loading.value = true
      hasMore.value = true
      try { await fetchPage(1, false) }
      catch (e) { ElMessage.error(e.message) }
      finally { loading.value = false }
    }

    // 无限滚动：加载下一页并追加
    const loadMore = async () => {
      if (loadingMore.value || loading.value || !hasMore.value || streaming.value) return
      loadingMore.value = true
      try { await fetchPage(page.value + 1, true) }
      catch (e) { ElMessage.error(e.message) }
      finally { loadingMore.value = false }
    }

    // 客户端过滤：SSE 是后端无差别广播所有新日志，前端必须自己过滤，
    // 语义与后端 like '%kw%' 对齐（大小写不敏感的包含匹配）。
    const matchFilter = (item) => {
      if (level.value && String(item.level || '').toUpperCase() !== level.value.toUpperCase()) return false
      const inc = (val, kw) => String(val || '').toLowerCase().includes(kw.toLowerCase())
      if (keyword.value && !inc(item.path, keyword.value)) return false
      if (ipSearch.value && !inc(item.client_ip, ipSearch.value)) return false
      if (uaSearch.value && !inc(item.ua_type, uaSearch.value)) return false
      if (userIdSearch.value && !inc(item.client_user_id, userIdSearch.value)) return false
      return true
    }

    // fetch 流式读取 SSE（可携带 Authorization 头，EventSource 不支持自定义头）
    const startStream = async () => {
      abortCtrl = new AbortController()
      try {
        const resp = await fetch('/api/v2/worker-logs/stream', {
          headers: { ...getAuthHeaders() }, signal: abortCtrl.signal,
        })
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (streaming.value) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split('\n\n')
          buffer = parts.pop()
          for (const part of parts) {
            const line = part.split('\n').find(l => l.startsWith('data: '))
            if (!line) continue
            try {
              const item = JSON.parse(line.slice(6))
              // 客户端过滤：不匹配当前搜索条件的实时日志直接跳过，与历史查询保持一致
              if (!matchFilter(item)) continue
              // SSE 推送无数据库 id，客户端生成唯一 _uid 避免 el-table 全部行共用同一 key
              item._uid = `sse-${Date.now()}-${Math.random().toString(36).slice(2)}`
              item._live = true
              // 实时流本身已带 body，无需再走详情接口
              item._bodyLoaded = true
              item.has_body = !!(item.request_body || item.response_body || item.query)
              items.value.unshift(item)
              if (items.value.length > 200) items.value.pop()
            } catch { /* 忽略心跳 */ }
          }
        }
      } catch (e) {
        if (streaming.value) ElMessage.warning('实时连接中断: ' + e.message)
      }
    }
    const toggleStream = (on) => {
      if (on) startStream()
      else if (abortCtrl) abortCtrl.abort()
    }

    const levelType = (l) => ({ ERROR: 'danger', WARN: 'warning', INFO: 'success' }[l] || 'info')
    // 缓存来源标签色：命中类绿色、MISS 灰、限流红
    const sourceType = (s) => {
      if (!s) return 'info'
      if (s === 'LOCAL-EMPTY') return 'info'  // 空结果负缓存：中性灰
      if (s.indexOf('429') >= 0 || s.indexOf('STALE') >= 0) return 'warning'
      if (s === 'MISS' || s === 'UPSTREAM-429') return s === 'MISS' ? 'info' : 'danger'
      return 'success'
    }
    // 缓存来源英文值 → 中文展示（仅用于显示，颜色判断仍用原始英文值）
    const sourceLabel = (s) => ({
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
    }[s] || s)
    // JSON 美化格式化（截断提示原样保留，JSON 则缩进展示）
    const fmtJson = (text) => {
      if (!text) return ''
      try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return text }
    }
    // 展开区渲染：开关开启且为合法 JSON 则格式化，否则原样返回
    const renderBody = (text) => {
      if (!text) return ''
      return prettyJson.value ? fmtJson(text) : text
    }
    const fmtBytes = (b) => {
      if (b == null) return '—'
      if (b < 1024) return b + 'B'
      if (b < 1024 * 1024) return (b / 1024).toFixed(1) + 'KB'
      return (b / 1024 / 1024).toFixed(2) + 'MB'
    }
    const rowClass = ({ row }) => (row._live ? 'live-row' : '')
    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')
    // 文件选择始终限定单个轮转文件；标签给出体积与行数，避免误解为跨文件搜索。
    const fileLabel = (file) => `${file.name} · ${file.size_mb}MB · ${file.line_count || 0}行`
    const fileRange = (file) => {
      if (!file.first_at && !file.last_at) return '暂无有效日志时间'
      return `${fmt(file.first_at)} ～ ${fmt(file.last_at)}`
    }

    // 表格已取消高度限制，改为监听整个页面滚动：接近页面底部（剩余 <120px）时加载下一页
    const onScroll = () => {
      const doc = document.documentElement
      if (doc.scrollHeight - window.scrollY - window.innerHeight < 120) loadMore()
    }

    onMounted(async () => {
      await loadFiles()  // 先加载文件列表
      await reload()
      await nextTick()
      window.addEventListener('scroll', onScroll, { passive: true })
      // 首屏内容不足以撑出滚动条时，自动补加载直到出现滚动条或无更多数据
      await ensureScrollable()
    })

    // 页面无滚动条则继续加载，避免用户无法触发下滑加载
    const ensureScrollable = async () => {
      let guard = 0  // 防御性上限，避免异常时无限循环
      while (hasMore.value && !streaming.value && guard < 20 &&
             document.documentElement.scrollHeight <= window.innerHeight + 10) {
        await loadMore()
        await nextTick()
        guard++
      }
    }
    onUnmounted(() => {
      streaming.value = false
      if (abortCtrl) abortCtrl.abort()
      window.removeEventListener('scroll', onScroll)
    })
    return { items, tableRef, files, selectedFile, level, keyword, ipSearch, uaSearch, userIdSearch,
      loading, loadingMore, hasMore, totalEstimated, streaming, prettyJson, expandedRows, Search,
      reload, loadMore, toggleStream, levelType, sourceType, sourceLabel, rowClass, fmtBytes, fmtJson,
      renderBody, fmt, fileLabel, fileRange, onExpand, decodeText }
  }
}
</script>

<style scoped>
.log-file-option { width: 280px; line-height: 1.35; padding: 3px 0; }
.log-file-option__main { display: flex; justify-content: space-between; gap: 12px; }
.log-file-option__stats { color: var(--el-text-color-secondary); font-size: 12px; white-space: nowrap; }
.log-file-option__range { color: var(--el-text-color-placeholder); font-size: 11px; }

:global(.worker-log-file-popper .el-select-dropdown__item) { height: auto; line-height: normal; padding-top: 5px; padding-bottom: 5px; }

:deep(.live-row) { background: #f6ffed; }
.body-expand { padding: 12px 20px; background: #fafafa; border-top: 1px solid #f0f0f0; }
.body-block { margin-bottom: 14px; }
.body-label { display: inline-block; font-size: 12px; font-weight: 600; color: #1677ff;
  background: #e6f4ff; border: 1px solid #91caff; border-radius: 4px;
  padding: 1px 8px; margin-bottom: 6px; }
.body-pre { margin: 0; font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-all;
  background: #fff; border: 1px solid #e8e8e8; border-radius: 6px;
  padding: 10px 14px; max-height: 360px; overflow-y: auto; color: #333; }
.body-empty { padding: 8px 0; color: #aaa; font-size: 13px; }
.load-more-hint { text-align: center; padding: 12px 0; color: #999; font-size: 13px; }
.load-more-tip { color: #bbb; }
</style>