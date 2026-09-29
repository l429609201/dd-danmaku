<script setup>
import { computed, onActivated, onDeactivated, onBeforeUnmount, ref, watch } from 'vue'
import { api } from './api.js'
import ScanScopePanel from './ScanScopePanel.vue'
import DashboardOverview from './DashboardOverview.vue'
const props = defineProps({ refreshToken: Number })
const data = ref(null), busy = ref(false), error = ref(''), actionError = ref(''), scopeReady = ref(false)
let timer, active = false, generation = 0
const result = computed(() => data.value?.scan?.result)
const totals = computed(() => (result.value?.libraries || []).reduce((sum, row) => {
  for (const key of Object.keys(sum)) sum[key] += row[key] || 0
  return sum
}, { total: 0, present: 0, missing: 0, skipped: 0, errors: 0, valid: 0, invalid: 0, empty: 0, comments: 0, bytes: 0 }))
const coverage = computed(() => {
  const n = totals.value.present + totals.value.missing
  return n ? `${(100 * totals.value.present / n).toFixed(1)}%` : '—'
})
function schedule() {
  clearTimeout(timer)
  if (active && !busy.value) timer = setTimeout(load, 3000)
}
async function load() {
  if (!active || busy.value) return
  clearTimeout(timer)
  const id = ++generation
  try {
    const response = await api.dashboard()
    if (!response?.scan || typeof response.deep !== 'boolean') throw new Error('仪表盘接口结构无效，请确认后端 DLL 版本')
    if (active && id === generation) { data.value = response; error.value = '' }
  } catch (e) { if (active && id === generation) error.value = e.message }
  finally { if (id === generation) schedule() }
}
async function act(action, mode = false) {
  if (busy.value) return
  // 写入前使全部旧轮询失效，防止旧值回盖刚保存的开关。
  busy.value = true; actionError.value = ''; ++generation; clearTimeout(timer)
  try {
    const response = await action()
    if (mode) {
      if (typeof response?.deep !== 'boolean') throw new Error('扫描模式保存回包无效')
      if (data.value) data.value = { ...data.value, deep: response.deep }
    }
  } catch (e) { actionError.value = `${e.message}；请刷新确认服务器实际状态` }
  finally { busy.value = false; if (active) await load() }
}
// KeepAlive 保留页面与草稿，离开时停止轮询，返回只更新只读状态。
onActivated(() => { active = true; load() })
function pause() { active = false; ++generation; clearTimeout(timer) }
onDeactivated(pause)
onBeforeUnmount(pause)
watch(() => props.refreshToken, () => { if (!busy.value) { actionError.value = ''; load() } })
</script>

<template>
  <section class="dashboard">
    <div class="dashboard-heading"><div><h1>仪表盘</h1><p>配置概览 · 媒体库弹幕覆盖情况</p></div></div>
    <el-alert v-if="error || actionError" :title="actionError || error" type="error" :closable="false" />
    <DashboardOverview :overview="data?.overview" />
    <el-card shadow="never">
      <div class="scan-toolbar">
        <div><strong>XML 弹幕扫描</strong><p>本地视频 / STRM → 同目录、同名 .xml；只读检查</p></div>
        <span>深度扫描</span><el-switch :model-value="data?.deep ?? false" inline-prompt active-text="开" inactive-text="关" :width="52" :loading="busy" :disabled="busy || !data || !!error" aria-label="深度扫描" @change="deep => act(() => api.saveScanMode(deep), true)" />
        <el-button type="primary" :disabled="busy || !data || !!error || !scopeReady || data.scan.running" @click="act(api.startScan)">立即扫描</el-button>
        <el-button :disabled="busy || !data?.scan?.running" @click="act(api.cancelScan)">取消扫描</el-button>
      </div>
      <!-- 范围未加载或草稿未保存时，不允许意外启动全库扫描。 -->
      <ScanScopePanel @ready="scopeReady = $event" />
      <p>快速：仅检查文件存在。深度：读取 XML 校验格式、统计弹幕条数。开关保存后同时用于手动与定时任务，不改变正在运行的任务。</p>
      <div class="scan-status"><el-tag :type="data?.scan?.running ? 'warning' : 'info'">{{ data?.scan?.state || '正在读取' }}</el-tag><span>本次已检查 {{ data?.scan?.processed || 0 }} 项</span><span>自动任务默认每日 04:00（服务器时间），可在 Emby 计划任务中调整。</span></div>
      <el-alert v-if="data?.scan?.error" :title="data.scan.error" type="warning" :closable="false" />
      <p v-if="result">上次完整结果：{{ new Date(result.completedUtc).toLocaleString() }} · {{ result.deep ? '深度' : '快速' }} · 耗时 {{ result.seconds.toFixed(1) }} 秒。扫描期间显示上次结果。统计仅包含：{{ result.libraries.map(row => row.name).join('、') || '无媒体库' }}。</p>
    </el-card>
    <template v-if="result">
      <div class="stat-grid">
        <el-card v-for="[label, value] in [['视频条目', totals.total], ['有同名 XML', totals.present], ['缺少 XML', totals.missing], ['覆盖率', coverage], ['跳过', totals.skipped], ['访问异常', totals.errors]]" :key="label" shadow="never"><span>{{ label }}</span><strong>{{ value }}</strong></el-card>
      </div>
      <div v-if="result.deep" class="stat-grid">
        <el-card v-for="[label, value] in [['有效 XML', totals.valid], ['无效 / 超限 XML', totals.invalid], ['空弹幕 XML', totals.empty], ['弹幕条数', totals.comments], ['XML 总大小', `${(totals.bytes / 1048576).toFixed(2)} MiB`]]" :key="label" shadow="never"><span>{{ label }}</span><strong>{{ value }}</strong></el-card>
      </div>
      <el-card shadow="never"><template #header>媒体库覆盖情况</template>
        <el-table :data="result.libraries" stripe>
          <el-table-column prop="name" label="媒体库" min-width="150" />
          <el-table-column v-for="[key, label] in [['total', '视频'], ['present', '有 XML'], ['missing', '缺少'], ['skipped', '跳过'], ['errors', '异常']]" :key="key" :prop="key" :label="label" width="90" />
          <el-table-column label="覆盖率" width="110"><template #default="{ row }">{{ row.coverage }}%</template></el-table-column>
          <el-table-column v-if="result.deep" prop="comments" label="弹幕条数" min-width="110" />
        </el-table>
        <p>按媒体条目统计；同一 XML 被多个版本或媒体库引用时可能重复计数。覆盖率 = 有 XML /（有 XML + 缺少 XML），存在不等于内容有效。</p>
      </el-card>
    </template>
    <el-empty v-else description="暂无完整扫描结果，请手动扫描或等待计划任务" />
  </section>
</template>

<style scoped>
.dashboard { display: grid; gap: 18px; }
.dashboard-heading, .scan-toolbar, .scan-status { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.dashboard-heading { justify-content: space-between; }
.scan-toolbar > div:first-child { margin-right: auto; }
p, .scan-status { color: #64748b; font-size: 13px; line-height: 1.7; }
.stat-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.stat-grid span { color: #64748b; font-size: 13px; }
.stat-grid strong { display: block; font-size: 26px; margin-top: 12px; color: #1d4ed8; }
@media (max-width: 900px) { .stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
