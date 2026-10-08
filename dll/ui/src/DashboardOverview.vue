<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { api } from './api.js'
// 连接卡片独立刷新，不阻塞已有概览和扫描。
const relay = ref(null)
let stopped = false, timer
async function checkRelay() {
  try { const value = await api.officialRelayHealth(); if (!stopped) relay.value = value }
  catch { if (!stopped) relay.value = { status: 'unknown' } }
  finally { if (!stopped) timer = setTimeout(checkRelay, 60000) }
}
onMounted(checkRelay)
onBeforeUnmount(() => { stopped = true; clearTimeout(timer) })
const relayLabel = value => ({ available: '搜索接口可用', 'auth-rejected': '鉴权拒绝', 'rate-limited': '流控／配额受限', unavailable: '接口不可用', timeout: '超时', unconfigured: '未配置', unknown: '检测失败' })[value] || '检测中'
defineProps({ overview: Object })
const state = value => value ? '开' : '关'
</script>
<template>
  <div v-if="overview" class="overview-grid">
    <el-card shadow="never">
      <template #header><strong>脚本注入</strong></template>
      <p>自动注入：{{ state(overview.autoInjectionEnabled) }}</p>
      <p>ede.js 资源：{{ state(overview.edeResourceEnabled) }}</p>
      <small>服务端配置，不代表播放页已实际加载脚本。</small>
    </el-card>
    <el-card shadow="never">
      <template #header><strong>服务器 XML 联动</strong></template>
      <p>总开关：{{ state(overview.xmlEnabled) }}</p>
      <p>有效读取 / 授权写入：{{ state(overview.xmlRead) }} / {{ state(overview.xmlWrite) }}</p>
      <p>优先本地 / 旧自动保存参数：{{ state(overview.preferLocal) }} / {{ state(overview.autoSave) }}</p>
      <small>当前自动播放不写 XML；共享 XML 需授权用户显式保存。</small>
    </el-card>
    <el-card shadow="never">
      <template #header><strong>AI 服务</strong></template>
      <p>总开关：{{ state(overview.aiEnabled) }} · {{ overview.aiConfigured ? '接入配置就绪' : '接入配置未就绪' }}</p>
      <p>模型：{{ overview.aiModel || '未配置' }}</p>
      <p>普通用户授权：{{ state(overview.aiUserAccess) }} · 名单 {{ overview.aiUserCount }} 人</p>
      <small>配置状态不代表上游服务已通过连通性验证。</small>
    </el-card>
    <el-card shadow="never">
      <template #header><strong>弹弹play 中转连接</strong></template>
      <p>状态：{{ relayLabel(relay?.status) }}</p>
      <p>最近搜索自检耗时：{{ relay?.latencyMilliseconds != null ? `${relay.latencyMilliseconds} ms` : '—' }}</p>
      <p>自检缓存时间：{{ relay?.checkedAt ? new Date(relay.checkedAt).toLocaleString() : '—' }}</p>
      <p v-if="relay?.httpStatus">HTTP：{{ relay.httpStatus }}</p>
      <p v-if="relay?.errorCode">错误码：{{ relay.errorCode }}</p>
      <small>测试搜索test是否有效</small>
    </el-card>
  </div>
  <el-alert v-else title="配置概览暂不可用，请确认后端 DLL 已更新并重启。" type="info" :closable="false" />
</template>
<style scoped>
.overview-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
p { font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
small { color: #64748b; line-height: 1.7; }
@media (max-width: 900px) { .overview-grid { grid-template-columns: 1fr; } }
</style>
