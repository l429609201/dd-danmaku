<template>
  <div class="page">
    <div class="page-header">
      <h1 class="page-title">仪表盘</h1>
      <el-button size="small" :loading="loading" @click="load">刷新</el-button>
    </div>

    <!-- 顶部汇总卡片 -->
    <div class="cards">
      <!-- 在线 Worker -->
      <div class="card" :class="data.worker.online_nodes > 0 ? 'card-ok' : 'card-warn'">
        <div class="card-label">在线 Worker</div>
        <div class="card-value">{{ data.worker.online_nodes ?? '—' }}</div>
        <div class="card-sub">共 {{ data.worker.total_nodes ?? 0 }} 个节点</div>
      </div>

      <!-- 响应缓存 -->
      <div class="card card-accent">
        <div class="card-label">响应缓存条目</div>
        <div class="card-value">{{ fmt(data.cache.total_entries) }}</div>
        <div class="card-sub">API 缓存</div>
      </div>

      <!-- 弹幕集数 -->
      <div class="card">
        <div class="card-label">本地弹幕</div>
        <div class="card-value">{{ fmt(data.danmaku.total_episodes) }}</div>
        <div class="card-sub">{{ fmtBytes(data.danmaku.total_size_mb * 1024 * 1024) }}</div>
      </div>

      <!-- 总弹幕条数 -->
      <div class="card">
        <div class="card-label">弹幕条数</div>
        <div class="card-value">{{ fmt(data.danmaku.total_comments) }}</div>
        <div class="card-sub">累计存档</div>
      </div>

      <!-- 番剧数量 -->
      <div class="card card-accent">
        <div class="card-label">番剧条目</div>
        <div class="card-value">{{ fmt(data.media.anime_count) }}</div>
        <div class="card-sub">{{ fmt(data.media.episode_count) }} 集 · {{ fmt(data.media.alias_count) }} 个别名</div>
      </div>

      <!-- 密钥与规则 -->
      <div class="card">
        <div class="card-label">密钥 / 规则</div>
        <div class="card-value">{{ fmt((data.keys_rules.api_key_count ?? 0) + (data.keys_rules.sign_key_count ?? 0)) }}</div>
        <div class="card-sub">IP 规则 {{ fmt(data.keys_rules.ip_rule_count) }} · UA 规则 {{ fmt(data.keys_rules.ua_rule_count) }}</div>
      </div>
    </div>

    <!-- 两列详情面板 -->
    <div class="detail-grid">
      <!-- 系统信息 -->
      <div class="panel">
        <div class="section-title">系统信息</div>
        <table class="data-table">
          <tbody>
            <tr><td>版本</td><td>{{ data.system.version ?? '—' }}</td></tr>
            <tr v-if="data.system.rust_version"><td>Rust 版本</td><td>{{ data.system.rust_version }}</td></tr>
            <tr v-if="data.system.build_time"><td>构建时间</td><td>{{ data.system.build_time }}</td></tr>
            <tr><td>运行平台</td><td>{{ data.system.os ?? '—' }} / {{ data.system.arch ?? '—' }}</td></tr>
            <tr><td>运行时长</td><td>{{ fmtUptime(data.system.uptime_seconds) }}</td></tr>
          </tbody>
        </table>
      </div>

      <!-- 媒体库统计 -->
      <div class="panel">
        <div class="section-title">媒体库</div>
        <table class="data-table">
          <tbody>
            <tr><td>番剧数量</td><td>{{ fmt(data.media.anime_count) }}</td></tr>
            <tr><td>集数条目</td><td>{{ fmt(data.media.episode_count) }}</td></tr>
            <tr><td>已审核别名</td><td>{{ fmt(data.media.alias_count) }}</td></tr>
          </tbody>
        </table>
      </div>

      <!-- 密钥与规则 -->
      <div class="panel">
        <div class="section-title">密钥与规则</div>
        <table class="data-table">
          <tbody>
            <tr><td>API 密钥池</td><td>{{ fmt(data.keys_rules.api_key_count) }}</td></tr>
            <tr><td>签名密钥池</td><td>{{ fmt(data.keys_rules.sign_key_count) }}</td></tr>
            <tr><td>IP 规则</td><td>{{ fmt(data.keys_rules.ip_rule_count) }}</td></tr>
            <tr><td>UA 规则</td><td>{{ fmt(data.keys_rules.ua_rule_count) }}</td></tr>
          </tbody>
        </table>
      </div>

      <!-- 弹幕详细 -->
      <div class="panel">
        <div class="section-title">本地弹幕</div>
        <table class="data-table">
          <tbody>
            <tr><td>剧集数</td><td>{{ fmt(data.danmaku.total_episodes) }}</td></tr>
            <tr><td>弹幕条数</td><td>{{ fmt(data.danmaku.total_comments) }}</td></tr>
            <tr><td>存储大小</td><td>{{ fmtBytes(data.danmaku.total_size_mb * 1024 * 1024) }}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 近期错误事件 -->
    <div class="panel" style="margin-top: 16px">
      <div class="section-title">近期错误事件</div>
      <div v-if="errorLoading" class="loading">加载中…</div>
      <div v-else-if="recentErrors.length === 0" class="empty">暂无错误事件</div>
      <table v-else class="data-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>类型</th>
            <th>消息</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="ev in recentErrors" :key="ev.id">
            <td style="white-space:nowrap">{{ fmtTime(ev.created_at) }}</td>
            <td>{{ ev.event_type }}</td>
            <td>{{ ev.message }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { apiV2 } from '@/utils/api'

const router = useRouter()
const loading = ref(false)
const errorLoading = ref(false)

// 默认数据结构（防止模板渲染时 undefined）
const makeDefault = () => ({
  worker: { online_nodes: null, total_nodes: null, total_messages: 0, recent_events: 0 },
  cache: { total_entries: 0, hit_rate: null, total_size_mb: null },
  danmaku: { total_episodes: 0, total_comments: 0, total_size_mb: 0 },
  system: { version: null, rust_version: null, build_time: null, os: null, arch: null, uptime_seconds: null },
  media: { anime_count: 0, episode_count: 0, alias_count: 0 },
  keys_rules: { api_key_count: 0, sign_key_count: 0, ip_rule_count: 0, ua_rule_count: 0 },
})

const data = ref(makeDefault())
const recentErrors = ref([])

// 加载仪表盘统计
async function load() {
  loading.value = true
  try {
    const stats = await apiV2('/dashboard/stats')
    data.value = {
      worker: stats.worker ?? makeDefault().worker,
      cache: stats.cache ?? makeDefault().cache,
      danmaku: stats.danmaku ?? makeDefault().danmaku,
      system: stats.system ?? makeDefault().system,
      media: stats.media ?? makeDefault().media,
      keys_rules: stats.keys_rules ?? makeDefault().keys_rules,
    }
  } catch (e) {
    console.error('仪表盘加载失败', e)
  } finally {
    loading.value = false
  }
}

// 加载近期错误事件
async function loadErrors() {
  errorLoading.value = true
  try {
    const res = await apiV2('/admin/events/errors?page=1&page_size=10')
    recentErrors.value = res.items ?? res ?? []
  } catch (e) {
    recentErrors.value = []
  } finally {
    errorLoading.value = false
  }
}

// 格式化数字（加千分位）
function fmt(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN')
}

// 格式化字节大小
function fmtBytes(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

// 格式化运行时长
function fmtUptime(secs) {
  if (secs == null) return '—'
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

// 格式化时间
function fmtTime(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

onMounted(() => {
  load()
  loadErrors()
})
</script>

<style scoped>
.page {
  padding: var(--spacing-lg);
  max-width: 1200px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-lg);
}

.page-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}

/* 顶部汇总卡片网格 */
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
}

.card {
  background: var(--color-bg-overlay);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--spacing-md);
}

.card-ok {
  border-left: 3px solid var(--color-success);
}

.card-warn {
  border-left: 3px solid var(--color-warning);
}

.card-accent {
  border-left: 3px solid var(--color-primary);
}

.card-label {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-bottom: 4px;
}

.card-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--color-text);
  line-height: 1.2;
}

.card-sub {
  font-size: 12px;
  color: var(--color-text-placeholder);
  margin-top: 4px;
}

/* 详情面板网格 */
.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--spacing-md);
}

.panel {
  background: var(--color-bg-overlay);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--spacing-md);
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: var(--spacing-sm);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.data-table th {
  text-align: left;
  color: var(--color-text-secondary);
  padding: 4px 8px 4px 0;
  border-bottom: 1px solid var(--color-border);
  font-weight: 500;
}

.data-table td {
  padding: 5px 8px 5px 0;
  color: var(--color-text);
  border-bottom: 1px solid var(--color-border-light, var(--color-border));
  vertical-align: top;
}

.data-table td:first-child {
  color: var(--color-text-secondary);
  width: 40%;
}

.data-table tr:last-child td {
  border-bottom: none;
}

.loading {
  color: var(--color-text-secondary);
  padding: var(--spacing-sm);
  font-size: 13px;
}

.empty {
  color: var(--color-text-placeholder);
  font-size: 13px;
  padding: var(--spacing-sm);
  text-align: center;
}
</style>
