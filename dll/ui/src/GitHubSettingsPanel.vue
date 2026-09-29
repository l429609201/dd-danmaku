<script setup>
import { onMounted, ref } from 'vue'
import { api } from './api.js'
const ready = ref(false), hasToken = ref(false), token = ref(''), clearToken = ref(false)
const busy = ref(false), error = ref(''), message = ref(''), release = ref(null)
import SavedSecretInput from './SavedSecretInput.vue'
const savedToken = ref('')
// 已保存值独立于替换草稿，避免重复请求和回显凭据被自动提交。
async function load() {
  busy.value = true; error.value = ''
  try {
    const data = await api.githubSettings()
    if (typeof data?.hasToken !== 'boolean') throw new Error('GitHub 设置响应无效')
    hasToken.value = data.hasToken; savedToken.value = data.token || ''; ready.value = true
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
async function save() {
  busy.value = true; error.value = ''; message.value = ''
  try {
    const data = await api.saveGithubSettings({ token: clearToken.value ? '' : token.value, clearToken: clearToken.value })
    if (typeof data?.hasToken !== 'boolean') throw new Error('保存回包无效，请重新读取确认')
    hasToken.value = data.hasToken; savedToken.value = data.token || ''; token.value = ''; clearToken.value = false; message.value = 'GitHub 设置已保存'
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
async function check() {
  busy.value = true; error.value = ''; message.value = ''; release.value = null
  try {
    const data = await api.checkUpdate()
    if (!data || typeof data.message !== 'string') throw new Error('更新检查响应无效')
    release.value = data; message.value = data.message
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
onMounted(load)
</script>
<template>
  <el-card shadow="never">
    <template #header>GitHub 更新设置</template>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-alert v-if="message" :title="message" type="success" :closable="false" />
    <el-button v-if="!ready" :disabled="busy" @click="load">重新读取</el-button>
    <!-- 仅管理员管理更新凭据，不混入播放器用户参数，也不在浏览器持久化。 -->
    <el-form v-if="ready" label-position="top" :disabled="busy" @submit.prevent>
      <el-form-item :label="`GitHub Token（${hasToken ? '已配置' : '未配置'}）`">
        <!-- 单框默认回填会话解码值，仅编辑时更新替换草稿。 -->
        <SavedSecretInput v-model="token" :value="savedToken" :disabled="busy || clearToken" />
      </el-form-item>
      <el-checkbox v-model="clearToken">明确清除已保存的 Token</el-checkbox>
      <p>Token 仅供服务器访问 GitHub API；不发送到下载链接。新凭据请先保存再检查。</p>
      <el-button type="primary" @click="save">保存 GitHub 设置</el-button>
      <el-button :disabled="!!token || clearToken" @click="check">检查正式发行版</el-button>
    </el-form>
    <p v-if="release">当前脚本：{{ release.currentVersion || '版本未知' }} · 正式发行版：{{ release.latestVersion || '无 DLL 附件' }}
      <a v-if="release.downloadUrl" :href="release.downloadUrl" target="_blank" rel="noopener noreferrer">下载 DLL</a>
    </p>
    <p>本页只检查并提供下载链接，不安装。Emby 中既有“自动更新 DD-Danmaku”计划任务仍按原配置执行，可在计划任务中调整。</p>
  </el-card>
</template>
