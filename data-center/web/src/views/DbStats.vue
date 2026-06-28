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
      </div>

      <!-- 数据库引擎性能指标：按方言分组卡片展示 -->
      <div class="panel" v-if="data.engine_perf && data.engine_perf.available">
        <div class="redis-head">
          <h2 class="panel-title">{{ enginePerfTitle }}</h2>
          <span class="redis-badge" v-if="data.engine_perf.version">v{{ data.engine_perf.version }}</span>
        </div>
        <div class="redis-groups">
          <div class="rgroup" v-for="g in data.engine_perf.groups" :key="g.title">
            <div class="rgroup-title">{{ g.title }}</div>
            <div class="kv" v-for="it in g.items" :key="it.label">
              <span>{{ it.label }}</span>
              <b :class="{ warn: it.warn }">{{ it.value }}</b>
            </div>
          </div>
        </div>
      </div>
      <!-- 不支持性能指标的数据库（如旧版/未知方言）给个说明占位 -->
      <div class="panel" v-else-if="data.engine_perf && !data.engine_perf.available">
        <h2 class="panel-title">数据库引擎指标</h2>
        <p class="muted">{{ data.engine_perf.note || data.engine_perf.error || '当前数据库暂无性能指标' }}</p>
      </div>

      <!-- Redis 独立分区：连接/内存/命中/持久化分组 -->
      <div class="panel redis-panel" v-if="data.redis && data.redis.enabled && !data.redis.error">
        <div class="redis-head">
          <h2 class="panel-title">Redis 状态</h2>
          <span class="redis-badge">v{{ data.redis.version || '—' }} · 运行 {{ fmtUptime(data.redis.uptime_seconds) }}</span>
        </div>
        <div class="redis-groups">
          <div class="rgroup">
            <div class="rgroup-title">连接</div>
            <div class="kv"><span>客户端连接</span><b>{{ data.redis.connected_clients }}</b></div>
            <div class="kv"><span>ops/sec</span><b>{{ data.redis.ops_per_sec }}</b></div>
          </div>
          <div class="rgroup">
            <div class="rgroup-title">内存</div>
            <div class="kv"><span>已用内存</span><b>{{ fmtBytes(data.redis.used_memory_bytes) }}</b></div>
            <div class="kv"><span>峰值内存</span><b>{{ fmtBytes(data.redis.used_memory_peak_bytes) }}</b></div>
            <div class="kv"><span>碎片率</span><b :class="{ warn: data.redis.mem_fragmentation_ratio > 1.5 }">{{ data.redis.mem_fragmentation_ratio }}</b></div>
          </div>
          <div class="rgroup">
            <div class="rgroup-title">命中</div>
            <div class="kv"><span>命中率</span><b>{{ data.redis.hit_rate }}%</b></div>
            <div class="kv"><span>命中/未命中</span><b>{{ data.redis.keyspace_hits }} / {{ data.redis.keyspace_misses }}</b></div>
            <div class="kv"><span>Key 总数</span><b>{{ data.redis.total_keys }}</b></div>
          </div>
          <div class="rgroup">
            <div class="rgroup-title">键空间维护</div>
            <div class="kv"><span>淘汰 keys</span><b :class="{ warn: data.redis.evicted_keys > 0 }">{{ data.redis.evicted_keys }}</b></div>
            <div class="kv"><span>过期 keys</span><b>{{ data.redis.expired_keys }}</b></div>
          </div>
        </div>
      </div>
      <div class="panel" v-else-if="data.redis && !data.redis.enabled">
        <h2 class="panel-title">Redis 状态</h2>
        <p class="muted">Redis 未启用，响应缓存使用 SQL 冷备模式。</p>
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

    // 引擎性能面板标题：随实际连接的数据库类型变化
    const enginePerfTitle = computed(() => {
      const d = data.value && data.value.engine_perf && data.value.engine_perf.dialect
      const map = { mysql: 'MySQL 性能指标', postgresql: 'PostgreSQL 性能指标', sqlite: 'SQLite 性能指标' }
      return map[d] || '数据库引擎指标'
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
    return { loading, error, data, updatedAt, poolText, enginePerfTitle, fmtBytes, fmtUptime, load }
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
.metrics { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.metric { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; background: #fafafa; border-radius: 8px; }
.m-label { color: #888; font-size: 13px; }
.m-val { font-size: 16px; font-weight: 600; color: #333; }
.m-val.warn { color: #cf1322; }
.redis-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 14px; }
.redis-head .panel-title { margin-bottom: 0; }
.redis-badge { font-size: 12px; color: #888; background: #f5f5f5; padding: 2px 10px; border-radius: 10px; }
.redis-groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
.rgroup { background: #fafafa; border-radius: 8px; padding: 14px; }
.rgroup-title { font-size: 13px; color: #1677ff; font-weight: 600; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #eee; }
.rgroup .kv { background: none; padding: 5px 0; }
.rgroup .kv b.warn { color: #cf1322; }
</style>
