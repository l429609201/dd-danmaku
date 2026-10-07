<script setup>
import { onMounted, ref } from 'vue'
import { api } from './api.js'
import SavedSecretInput from './SavedSecretInput.vue'
const savedKey = ref('')
// 回显与替换分开，修改服务地址时仍要求明确填写密钥。
function accept(result) { savedKey.value = result.apiKey || ''; data.value = { ...result, apiKey: '', clearApiKey: false, prompt: result.prompt || result.defaultPrompt }; keyEdited.value = false }
const data = ref(null), models = ref([]), busy = ref(false), modelsBusy = ref(false), testing = ref(false), error = ref(''), message = ref(''), modelsError = ref(''), testResult = ref(null), testError = ref(''), keyEdited = ref(false)
async function load() {
  busy.value = true; error.value = ''
  try { accept(await api.aiSettings()) } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
// 草稿凭据遵循模型查询同一安全规则：未编辑时不带回填密钥，地址变化也不会复用旧密钥。
function credentials(includeModel = false) {
  const draft = { baseUrl: data.value.baseUrl, clearApiKey: !!data.value.clearApiKey, timeoutSeconds: data.value.timeoutSeconds }
  if (keyEdited.value && !draft.clearApiKey) draft.apiKey = data.value.apiKey?.trim() || ''
  if (includeModel) draft.model = data.value.model?.trim() || ''
  return draft
}
async function testConnection(testMode = 'connection') {
  testing.value = true; testError.value = ''; testResult.value = null
  try { testResult.value = await api.testAi({ ...credentials(true), testMode,
    prompt: data.value.prompt, confidenceThreshold: data.value.confidenceThreshold, maxCandidates: data.value.maxCandidates }) }
  catch (e) { testError.value = e.code ? `${e.code}：${e.message}` : e.message }
  finally { testing.value = false }
}
async function refreshModels() {
  modelsBusy.value = true; modelsError.value = ''; models.value = []
  try { const result = await api.aiModels(credentials()); models.value = result.models || result.Models || []; if (!models.value.length) modelsError.value = '服务未返回可用模型，仍可手动输入模型名称' }
  catch (e) { modelsError.value = `模型刷新失败：${e.message}` }
  finally { modelsBusy.value = false }
}
async function save() {
  busy.value = true; error.value = ''; message.value = ''
  try {
    const draft = { ...data.value, ...credentials() }
    const expectedKey = draft.clearApiKey ? '' : draft.apiKey?.trim() || savedKey.value
    await api.saveAiSettings(draft)
    // 独立重新读取核对，读取失败或不一致时保留草稿，且不暴露密钥。
    const stored = await api.aiSettings()
    if (stored.baseUrl !== draft.baseUrl?.trim().replace(/\/+$/, '')
      || stored.model !== draft.model?.trim() || (stored.apiKey || '') !== expectedKey)
      throw new Error('保存后重新读取的连接参数不一致，请勿关闭页面；请检查宿主配置持久化')
    accept(stored); message.value = 'AI 接入已保存，并已重新读取核对'
  }
  catch (e) { error.value = e.message }
  finally { busy.value = false }
}
onMounted(load)
</script>

<template>
  <el-card shadow="never" class="ai-settings" v-loading="busy">
    <template #header><strong>AI 服务接入</strong><p>OpenAI 兼容接口 · 密钥默认解码回填并遮罩；响应混淆不替代 HTTPS</p></template>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-alert v-if="message" :title="message" type="success" :closable="false" />
    <el-button v-if="!data && !busy" @click="load">重新读取</el-button>
    <el-form v-if="data" label-position="top" :disabled="busy || modelsBusy || testing" @submit.prevent="save">
      <!-- 模型查询与实际匹配开关解耦，禁止查询期间改动草稿导致列表与地址不一致。 -->
      <el-alert v-if="data.migrationNotice" :title="data.migrationNotice" type="warning" :closable="false" />
      <div class="ai-grid">
        <section>
          <h3>OpenAI 兼容服务</h3>
          <el-form-item label="Base URL（含版本路径，例如 /v1）"><el-input v-model="data.baseUrl" placeholder="https://api.example.com/v1" @input="models = []" /></el-form-item>
          <el-form-item label="模型名称">
            <!-- 下拉框自适应剩余宽度，刷新按钮保持固定宽度；空间不足时自然换行。 -->
            <div class="model-controls">
              <el-select v-model="data.model" class="model-select" filterable allow-create default-first-option :disabled="busy || modelsBusy || testing" placeholder="可刷新列表，也可手动输入"><el-option v-for="model in models" :key="model" :label="model" :value="model" /></el-select>
              <el-button class="model-refresh" :loading="modelsBusy" :disabled="busy || modelsBusy || testing" @click="refreshModels">刷新模型列表</el-button>
            </div>
            <el-alert v-if="modelsError" class="model-error" :title="modelsError" type="warning" :closable="false" />
          </el-form-item>
          <el-form-item :label="`API Key（可选，${data.hasApiKey ? '已配置，默认回填' : '尚未配置'}）`">
            <SavedSecretInput v-model="data.apiKey" :value="savedKey" :disabled="busy || modelsBusy || testing || data.clearApiKey" @draft="keyEdited = true" />
          </el-form-item>
          <el-checkbox v-model="data.clearApiKey">保存或查询时不使用已有密钥（保存后清除）</el-checkbox>
          <p>模型列表使用当前表单地址，无需先保存或开启 AI。地址以 Emby 服务器为访问起点；匹配自适应 Responses 与 Chat Completions。更换地址后请填写新的密钥，或勾选不使用已有密钥；未编辑的回填值不会自动发送到新地址。</p>
        </section>
        <section>
          <el-button type="primary" :loading="testing" :disabled="busy || modelsBusy || testing" @click="testConnection('connection')">测试连接/生成</el-button>
          <el-button :disabled="busy || modelsBusy || testing" @click="testConnection('match-single')">单候选匹配测试</el-button>
          <el-button :disabled="busy || modelsBusy || testing" @click="testConnection('match-multiple')">多候选匹配测试</el-button>
           <el-alert v-if="testError" class="test-error" :title="testError" type="error" :closable="false" />
           <el-descriptions v-if="testResult" class="test-result" title="测试结果" :column="2" border>
             <el-descriptions-item label="状态">{{ testResult.status || '未知' }}</el-descriptions-item>
             <el-descriptions-item label="协议">{{ testResult.protocol || '未知' }}</el-descriptions-item>
             <el-descriptions-item label="耗时">{{ testResult.elapsedMilliseconds ?? '-' }} ms</el-descriptions-item>
             <el-descriptions-item label="响应有效">{{ testResult.responseValid ? '是' : '否' }}</el-descriptions-item>
             <el-descriptions-item v-if="testResult.testMode" label="实际模式">{{ testResult.modeUsed }}</el-descriptions-item>
             <el-descriptions-item v-if="testResult.testMode" label="样例选择正确">{{ testResult.selectedExpected ? '是' : '否' }}</el-descriptions-item>
           </el-descriptions>
           <pre v-if="testResult?.testMode" class="test-details">{{ JSON.stringify({ candidates: testResult.candidates, warnings: testResult.warnings, steps: testResult.steps }, null, 2) }}</pre>
           <h3>请求与匹配约束</h3>
          <el-form-item label="请求超时（秒）"><el-input-number v-model="data.timeoutSeconds" :min="1" :max="120" /></el-form-item>
          <el-form-item label="最低匹配分数（不是概率）"><el-input-number v-model="data.confidenceThreshold" :min="0" :max="1" :step="0.05" :precision="2" /></el-form-item>
          <!-- 与后端安全硬上限一致；默认值由服务端返回，不覆盖已保存配置。 -->
          <el-form-item label="最大候选数（默认200）"><el-input-number v-model="data.maxCandidates" :min="1" :max="1000" :precision="0" /></el-form-item>
          <p>仍需开启上方 AI 总开关。请求会发送匹配所需的媒体信息，请仅配置可信服务；非受信网络应使用 HTTPS。</p>
        </section>
      </div>
      <!-- 默认值来自服务端；填充只修改草稿，保存后生效。 -->
      <el-form-item label="匹配提示词"><el-input v-model="data.prompt" type="textarea" :rows="7" maxlength="8192" show-word-limit placeholder="留空使用默认提示词" /><el-button @click="data.prompt = data.defaultPrompt">填充默认</el-button></el-form-item>
      <el-button type="primary" native-type="submit" :loading="busy">保存 AI 接入</el-button>
    </el-form>
  </el-card>
</template>

<style scoped>
.ai-settings { margin-top: 20px; }
.ai-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
.ai-grid section { background: #f8fafc; border-radius: 10px; padding: 20px; }
.model-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; width: 100%; min-width: 0; }
.model-select { flex: 1 1 200px; width: 0; min-width: min(200px, 100%); }
.model-refresh { flex: 0 0 148px; margin-left: 0; }
.model-error { margin-top: 8px; }
.test-details { max-height: 320px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
.test-error, .test-result { margin-top: 12px; }
p { font-size: 13px; color: #64748b; line-height: 1.6; }
h3 { margin-top: 0; }
@media (max-width: 900px) { .ai-grid { grid-template-columns: 1fr; } }
</style>
