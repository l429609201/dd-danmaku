<script setup>
// 概览只显示服务端配置，不读取密钥，也不推断客户端或上游连接状态。
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
      <p>有效读取 / 管理员写入：{{ state(overview.xmlRead) }} / {{ state(overview.xmlWrite) }}</p>
      <p>优先本地 / 管理员自动保存：{{ state(overview.preferLocal) }} / {{ state(overview.autoSave) }}</p>
      <small>自动保存只新增，不覆盖已有 XML。</small>
    </el-card>
    <el-card shadow="never">
      <template #header><strong>AI 服务</strong></template>
      <p>总开关：{{ state(overview.aiEnabled) }} · {{ overview.aiConfigured ? '接入配置就绪' : '接入配置未就绪' }}</p>
      <p>模型：{{ overview.aiModel || '未配置' }}</p>
      <p>普通用户授权：{{ state(overview.aiUserAccess) }} · 名单 {{ overview.aiUserCount }} 人</p>
      <small>配置状态不代表上游服务已通过连通性验证。</small>
    </el-card>
  </div>
  <el-alert v-else title="配置概览暂不可用，请确认后端 DLL 已更新并重启。" type="info" :closable="false" />
</template>
<style scoped>
.overview-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
p { font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
small { color: #64748b; line-height: 1.7; }
@media (max-width: 900px) { .overview-grid { grid-template-columns: 1fr; } }
</style>
