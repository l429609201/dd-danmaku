<script setup>
import { onMounted, reactive, ref, watch } from 'vue'
import { useSafeDrafts } from './useUiState.js'
import { api } from './api.js'
const form = reactive({ enabled: false, baseUrl: '', sourceId: '', serverType: 'generic', appId: '', appSecret: '', clearSecret: false })
const busy = ref(false), error = ref(''), notice = ref(''), hasSecret = ref(false)
const drafts = useSafeDrafts('proxy-settings', key => ['enabled', 'sourceId', 'serverType'].includes(key))
let filling = false
watch(form, value => {
  if (busy.value || filling) return
  for (const [key, item] of Object.entries(value)) drafts.stage(key, item)
}, { flush: 'sync' })
function discardDraft() { drafts.discard(); void load() }
function applySettings(data) {
  // 只读状态单独保存，不能回传到严格校验的配置接口。
  Object.assign(form, { enabled: data.enabled, baseUrl: data.baseUrl || '', sourceId: data.sourceId || '',
    serverType: data.serverType || 'generic', appId: data.appId || '', appSecret: '', clearSecret: false })
  hasSecret.value = data.hasSecret === true
}
async function load() {
  busy.value = true; error.value = ''
  try {
    applySettings(await api.proxySettings())
    drafts.select('instance')
    filling = true
    Object.assign(form, drafts.entries.value)
    filling = false
  }
  catch (e) { error.value = e.message }
  finally { busy.value = false }
}
async function save() {
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const { enabled, baseUrl, sourceId, serverType, appId, appSecret, clearSecret } = form
    const data = await api.saveProxySettings({ enabled, baseUrl, sourceId, serverType, appId, appSecret, clearSecret })
    drafts.discard()
    applySettings(data)
    notice.value = '配置已保存；请验证当前上游可用性。'
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
async function verify() {
  busy.value = true; error.value = ''; notice.value = ''
  try { await api.validateProxy(); notice.value = '后端当前已保存的上游配置验证通过。' }
  catch (e) { error.value = e.message }
  finally { busy.value = false }
}
// 验证只使用后台已保存配置，不把草稿密钥发往普通用户验证接口。
onMounted(load)
</script>
<template>
  <section class="panel"><el-card shadow="never">
    <template #header><strong>本地中转 API 设置</strong></template>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-alert v-if="notice" :title="notice" type="success" :closable="false" />
    <p>此设置对当前 Emby 实例生效。播放器通过 Emby 中转访问下方配置的弹幕 API。请使用可信地址；中转请求不会携带 Emby 登录令牌。</p>
    <div v-if="drafts.count.value" role="status">已保留未保存草稿 <el-button link :disabled="busy" @click="discardDraft">丢弃草稿</el-button></div>
    <el-form :model="form" :disabled="busy" label-position="top" @submit.prevent="save">
      <el-form-item label="启用代理"><el-switch v-model="form.enabled" /></el-form-item>
      <el-form-item label="上游 API 前缀"><el-input v-model="form.baseUrl" maxlength="2048" placeholder="填写服务提供的完整 API 前缀" /><p class="field-hint">按服务提供的地址填写，例如 /api/v2 或 /api/v1/访问令牌；保留原有路径，不需要改成 /api/v2，也不要附加 /search/anime 等具体接口。</p></el-form-item>
      <!-- 来源标识不随服务器类型变化，避免同一来源生成不同文件。 -->
      <el-form-item label="稳定来源标识（留空不自动保存）"><el-input v-model="form.sourceId" maxlength="64" placeholder="例如 misaka，不可使用 dandanplay" /></el-form-item>
      <el-form-item label="服务器类型"><el-select v-model="form.serverType"><el-option value="generic" label="通用兼容 API（搜索 test 验证）" /><el-option value="Misaka_Danmu_Server" label="御坂弹幕（版本接口验证）" /></el-select></el-form-item>
      <el-form-item label="AppId（可选）"><el-input v-model="form.appId" maxlength="256" /></el-form-item>
      <el-form-item :label="hasSecret ? 'AppSecret（已保存，留空保留）' : 'AppSecret（可选）'"><el-input v-model="form.appSecret" type="password" show-password autocomplete="new-password" maxlength="2048" /></el-form-item>
      <el-checkbox v-model="form.clearSecret">清除已保存密钥</el-checkbox>
      <div class="toolbar"><el-button type="primary" native-type="submit">保存</el-button><el-button @click="verify">验证已保存配置</el-button></div>
    </el-form>
  </el-card></section>
</template>
<style scoped>
.field-hint{margin:6px 0 0;color:var(--el-text-color-secondary);font-size:12px;line-height:1.5}
.toolbar{margin-top:16px;display:flex;gap:8px;flex-wrap:wrap}.el-select{width:100%}
</style>
