<template>
  <div class="page">
    <h1 class="page-title">数据库状态</h1>
    <div class="toolbar">
      <button class="btn btn-primary" @click="load">刷新</button>
      <span v-if="updatedAt" class="muted">更新于 {{ updatedAt }}</span>
    </div>

    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="error" class="error-box">{{ error }}</div>

    <template v-else-if="data">
      <!-- 概览卡 -->
      <div class="cards">
        <div class="card card-accent">
          <div class="card-label">数据库类型</div>
          <div class="card-value">{{ data.sql.dialect }}</div>
          <div class="card-sub">{{ data.sql.table_count }} 张表</div>
        </div>
        <div class="card">
          <div class="card-label">SQL 总占用</div>
          <div class="card-value">{{ fmtBytes(data.sql.total_size_bytes) }}</div>
        </div>
        <div class="card">
          <div class="card-label">连接池</div>
          <div class="card-value">{{ poolText }}</div>
          <div class="card-sub">活跃 / 池大小</div>
        </div>
        <div class="card" :class="data.redis.enabled ? 'card-ok' : 'card-warn'">
          <div class="card-label">Redis</div>
          <div class="card-value">{{ data.redis.enabled ? '在线' : '未启用' }}</div>
          <div class="card-sub" v-if="data.redis.enabled">{{ data.redis.used_memory_human || '—' }}</div>
        </div>
        <div class="card" v-if="data.redis.enabled">
          <div class="card-label">Redis 命中率</div>
          <div class="card-value">{{ data.redis.hit_rate }}%</div>
          <div class="card-sub">{{ data.redis.total_keys }} keys / {{ data.redis.connected_clients }} 连接</div>
        </div>
        <div class="card" v-if="data.comment_store" :class="data.comment_store.usage_ratio > 90 ? 'card-warn' : 'card-accent'">
          <div class="card-label">本地弹幕兜底</div>
          <div class="card-value">{{ fmtBytes(data.comment_store.total_size_bytes) }}</div>
          <div class="card-sub">{{ data.comment_store.file_count }} 集 / 上限 {{ fmtBytes(data.comment_store.max_bytes) }}（{{ data.comment_store.usage_ratio }}%）</div>
        </div>
      </div>

      <!-- 表清单 -->
      <div class="panel">
        <h2 class="panel-title">表统计</h2>
        <table class="data-table">
          <thead><tr><th>表名</th><th>行数</th><th>占用</th><th>占比</th></tr></thead>
          <tbody>
            <tr v-for="t in data.sql.tables" :key="t.name">
              <td class="key">{{ t.name }}</td>
              <td>{{ t.row_count.toLocaleString() }}</td>
              <td>{{ fmtBytes(t.size_bytes) }}</td>
              <td>
                <div class="ratio-wrap">
                  <div class="ratio-bar" :style="{ width: t.size_ratio + '%' }"></div>
                  <span class="ratio-text">{{ t.size_ratio }}%</span>
                </div>
              </td>
            </tr>
            <tr v-if="!data.sql.tables.length"><td colspan="4" class="empty">暂无表数据</td></tr>
          </tbody>
        </table>
        <div v-if="data.sql.dialect === 'sqlite' && data.sql.total_size_bytes === 0" class="muted hint">
          提示：SQLite 未编译 dbstat 扩展时无法统计单表字节，仅显示行数。
        </div>
      </div>

      <!-- Redis 详情 -->
      <div class="panel" v-if="data.redis.enabled && !data.redis.error">
        <h2 class="panel-title">Redis 详情</h2>
        <div class="kv-grid">
          <div class="kv"><span>版本</span><b>{{ data.redis.version || '—' }}</b></div>
          <div class="kv"><span>已用内存</span><b>{{ fmtBytes(data.redis.used_memory_bytes) }}</b></div>
          <div class="kv"><span>连接数</span><b>{{ data.redis.connected_clients }}</b></div>
          <div class="kv"><span>Key 总数</span><b>{{ data.redis.total_keys }}</b></div>
          <div class="kv"><span>命中 / 未命中</span><b>{{ data.redis.keyspace_hits }} / {{ data.redis.keyspace_misses }}</b></div>
          <div class="kv"><span>运行时长</span><b>{{ fmtUptime(data.redis.uptime_seconds) }}</b></div>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'DbStats',
  setup() {
    const loading = ref(true)
    const error = ref('')
    const data = ref(null)
    const updatedAt = ref('')

    const load = async () => {
      loading.value = true; error.value = ''
      try {
        const res = await apiV2('/dashboard/db-stats')
        data.value = res.data
        updatedAt.value = new Date().toLocaleTimeString()
      } catch (e) { error.value = e.message } finally { loading.value = false }
    }

    const poolText = computed(() => {
      const p = data.value && data.value.sql.pool
      if (!p || p.size == null) return '—'
      return `${p.checked_out ?? 0} / ${p.size}`
    })

    const fmtBytes = (n) => {
      n = Number(n) || 0
      if (n < 1024) return n + ' B'
      if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'
      if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB'
      return (n / 1073741824).toFixed(2) + ' GB'
    }
    const fmtUptime = (s) => {
      s = Number(s) || 0
      const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600)
      return d > 0 ? `${d}天${h}小时` : `${h}小时`
    }

    onMounted(load)
    return { loading, error, data, updatedAt, poolText, fmtBytes, fmtUptime, load }
  }
}
</script>

<style scoped>
.page { padding: 24px; }
.page-title { font-size: 22px; margin-bottom: 20px; color: #333; }
.toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
.btn { padding: 8px 16px; border: 1px solid #d9d9d9; background: #fff; border-radius: 6px; cursor: pointer; }
.btn-primary { background: #1677ff; color: #fff; border-color: #1677ff; }
.muted { color: #999; font-size: 12px; }
.hint { margin-top: 10px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
.card { background: #fff; border-radius: 10px; padding: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
.card-accent { border-left: 4px solid #1677ff; }
.card-ok { border-left: 4px solid #52c41a; }
.card-warn { border-left: 4px solid #faad14; }
.card-label { color: #888; font-size: 13px; margin-bottom: 8px; }
.card-value { font-size: 24px; font-weight: 600; color: #333; }
.card-sub { color: #999; font-size: 12px; margin-top: 4px; }
.panel { background: #fff; border-radius: 10px; padding: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); margin-bottom: 24px; }
.panel-title { font-size: 16px; margin-bottom: 14px; color: #333; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
.data-table th { color: #888; font-weight: 500; }
.key { font-family: monospace; font-size: 12px; }
.ratio-wrap { position: relative; background: #f0f0f0; border-radius: 4px; height: 18px; min-width: 120px; }
.ratio-bar { background: #1677ff; height: 100%; border-radius: 4px; max-width: 100%; }
.ratio-text { position: absolute; left: 8px; top: 0; font-size: 11px; line-height: 18px; color: #333; }
.empty { text-align: center; color: #999; padding: 20px; }
.kv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.kv { display: flex; justify-content: space-between; padding: 10px 12px; background: #fafafa; border-radius: 6px; font-size: 13px; }
.kv span { color: #888; }
.loading, .error-box { padding: 40px; text-align: center; color: #999; }
.error-box { color: #d4380d; }
</style>
