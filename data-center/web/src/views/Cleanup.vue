<template>
  <div class="page">
    <h1 class="page-title">数据清理</h1>
    <p v-if="msg" class="msg">{{ msg }}</p>

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

    <!-- 专项清理：脏缓存 -->
    <div class="panel">
      <h2 class="panel-title">脏缓存清理</h2>
      <p class="purge-desc">
        清理响应缓存中
        <b>空结果 / success:false / errorCode≠0</b>
        的无效数据（SQL + Redis），修复"搜索命中却返回空"的问题。建议先扫描预览再清理。
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
        <button class="btn btn-danger" :disabled="purging || scanning" @click="purgeDirty">
          {{ purging ? '清理中...' : '确认清理' }}
        </button>
        <span v-if="scanResult" class="scan-result">{{ scanResult }}</span>
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

    <!-- 清理结果 -->
    <div v-if="lastResult" class="panel">
      <h2 class="panel-title">上次清理结果</h2>
      <pre class="result">{{ lastResult }}</pre>
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'Cleanup',
  setup() {
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

    // 构造脏缓存筛选请求体（reasons 为空数组时传 null=全部）
    const dirtyBody = () => ({
      api_path_prefix: dirty.value.api_path_prefix || null,
      older_than_days: dirty.value.older_than_days || 0,
      reasons: dirty.value.reasons.length ? dirty.value.reasons : null,
    })

    // 脏缓存预览：只统计不删除
    const scanDirty = async () => {
      scanning.value = true
      scanResult.value = ''
      msg.value = ''
      try {
        const res = await apiV2('/cleanup/scan-dirty-cache', { method: 'POST', body: dirtyBody() })
        scanResult.value = res.message || ''
        lastResult.value = JSON.stringify(res.data, null, 2)
      } catch (e) { msg.value = e.message } finally { scanning.value = false }
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
        await load()
      } catch (e) { msg.value = e.message } finally { purging.value = false }
    }

    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')

    onMounted(load)
    return { policies, schedule, intervalMin, msg, running, purging, scanning,
      scanResult, dirty, lastResult,
      savePolicy, saveSchedule, runAll, runOne, scanDirty, purgeDirty, fmt }
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
</style>
