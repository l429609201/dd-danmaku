<script setup>
import { computed, onMounted, ref } from 'vue'
import { api } from './api.js'
import AiSettingsPanel from './AiSettingsPanel.vue'
const config = ref(null), users = ref([]), busy = ref(false), error = ref(''), message = ref('')
const usersReady = ref(false)
// 已删除用户仍保留可取消条目，加载失败不能隐式丢失授权。
const options = computed(() => {
  const known = new Set(users.value.map(u => u.id))
  return [...users.value, ...(config.value?.aiAllowedUserIds || []).filter(id => !known.has(id))
    .map(id => ({ id, name: `未找到的用户（${id}）` }))]
})
async function loadUsers() {
  usersReady.value = false
  try { users.value = await api.users(); usersReady.value = true }
  catch (e) { error.value = e.message }
}
async function load() {
  busy.value = true; error.value = ''
  try { config.value = await api.config(); await loadUsers() }
  catch (e) { error.value = e.message }
  finally { busy.value = false }
}
async function save() {
  busy.value = true; error.value = ''; message.value = ''
  try {
    // 本页统一维护匹配策略和 AI 授权，合并最新配置以保留运行设置。
    const latest = await api.config()
    config.value = await api.saveConfig({ ...latest, aiEnabled: config.value.aiEnabled,
      aiUserAccessEnabled: config.value.aiUserAccessEnabled, aiAllowedUserIds: config.value.aiAllowedUserIds,
      matchStrategy: config.value.matchStrategy, allowMatchFallback: config.value.allowMatchFallback })
    message.value = '匹配策略与 AI 授权已保存'
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
onMounted(load)
</script>
<template>
  <section class="panel">
    <el-card shadow="never" v-loading="busy">
      <template #header>AI 匹配授权</template>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <el-alert v-if="message" :title="message" type="success" :closable="false" />
      <el-button v-if="!config" @click="load">重新加载</el-button>
      <el-form v-if="config" label-width="170px" :disabled="busy">
        <!-- 策略不依赖 AI 开关；AI 故障始终降级普通匹配。 -->
        <el-form-item label="首选匹配方式"><el-radio-group v-model="config.matchStrategy"><el-radio-button value="traditional-first">传统优先</el-radio-button><el-radio-button value="ai-first">AI 优先</el-radio-button></el-radio-group></el-form-item>
        <el-form-item label="允许匹配回退"><el-switch v-model="config.allowMatchFallback" inline-prompt active-text="开" inactive-text="关" :width="52" /></el-form-item>
        <p>回退开关控制首选方式无法确认时是否尝试另一方式；AI 未启用、未授权、不可用或调用失败时始终降级普通匹配。</p>

        <el-form-item label="启用 AI 匹配"><el-switch v-model="config.aiEnabled" inline-prompt active-text="开" inactive-text="关" :width="52" /></el-form-item>
        <el-form-item label="允许普通用户使用"><el-switch v-model="config.aiUserAccessEnabled" inline-prompt active-text="开" inactive-text="关" :width="52" :disabled="!config.aiEnabled" /></el-form-item>
        <el-form-item label="授权用户">
          <div>
            <el-button @click="loadUsers">刷新用户列表</el-button>
            <el-checkbox-group v-model="config.aiAllowedUserIds" :disabled="!usersReady || !config.aiEnabled || !config.aiUserAccessEnabled">
              <el-checkbox v-for="u in options" :key="u.id" :label="u.id" :value="u.id" :disabled="(u.isDisabled || u.isAdministrator) && !config.aiAllowedUserIds.includes(u.id)">{{ u.name }}{{ u.isAdministrator ? '（管理员无需授权）' : u.isDisabled ? '（已禁用）' : '' }}</el-checkbox>
            </el-checkbox-group>
          </div>
        </el-form-item>
        <p>总开关关闭时所有用户不可调用 AI；普通用户需命中名单。此授权不授予后台管理或 XML 写入权限。</p>
        <el-button type="primary" @click="save">保存 AI 授权</el-button>
      </el-form>
    </el-card>
    <AiSettingsPanel />
  </section>
</template>
