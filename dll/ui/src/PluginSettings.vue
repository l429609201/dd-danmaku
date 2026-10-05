<script setup>
import { onMounted, ref } from 'vue'
import { api } from './api.js'
// 更新凭据独立保存，避免与运行设置互相覆盖。
import GitHubSettingsPanel from './GitHubSettingsPanel.vue'
import SelectionSettingsPanel from './SelectionSettingsPanel.vue'
const config = ref(null), busy = ref(false), error = ref(''), message = ref('')
async function load() {
  busy.value = true; error.value = ''
  // 运行配置独立加载，不受弹幕存储设置读取失败影响。
  try { config.value = await api.config() }
  catch (e) { error.value = e.message }
  finally { busy.value = false }
}
async function saveRuntime() {
  busy.value = true; error.value = ''; message.value = ''
  try {
    // 仅更新本页运行字段，保留其他页面的 AI 授权及 XML 策略。
    const latest = await api.config()
    config.value = await api.saveConfig({ ...latest, autoInjectionEnabled: config.value.autoInjectionEnabled,
      edeResourceEnabled: config.value.edeResourceEnabled, resourceVersion: config.value.resourceVersion,
      logLevel: config.value.logLevel, updateChannel: config.value.updateChannel }) // 匹配策略由 AI 服务页维护，不提交本页旧草稿。
    message.value = '运行设置已保存'
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
onMounted(load)
</script>

<template>
  <section class="panel">
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-alert v-if="message" :title="message" type="success" :closable="false" />
    <el-button v-if="!config" :disabled="busy" @click="load">重新加载设置</el-button>
    <el-card v-if="config" v-loading="busy" shadow="never">
      <template #header>脚本注入与运行</template>
      <el-form label-width="170px" :disabled="busy">
        <!-- 匹配策略统一移至 AI 服务，运行设置不维护重复入口。 -->

        <el-form-item label="自动注入"><el-switch v-model="config.autoInjectionEnabled" inline-prompt active-text="开" inactive-text="关" :width="52" /></el-form-item>
        <el-form-item label="更新频道"><el-select v-model="config.updateChannel" style="width: 220px"><el-option label="main（正式版）" value="main" /><el-option label="test（测试版）" value="test" /></el-select><span>默认使用 main；test 对应 GitHub 的 test-release 预发行版。</span></el-form-item>
        <el-collapse><el-collapse-item title="高级设置" name="advanced">
          <el-form-item label="资源缓存标识"><el-input v-model="config.resourceVersion" /><span>用于刷新浏览器缓存，不是 ede.js 版本号。</span></el-form-item>
          <el-form-item label="日志级别"><el-select v-model="config.logLevel"><el-option v-for="level in ['Information', 'Warning', 'Error']" :key="level" :label="level" :value="level" /></el-select></el-form-item>
        </el-collapse-item></el-collapse>
        <el-button type="primary" @click="saveRuntime">保存运行设置</el-button>
      </el-form>
    </el-card>
    <!-- 存储与授权统一保存，运行设置和更新凭据仍各自独立。 -->
    <SelectionSettingsPanel />
    <!-- 更新设置独立加载，XML 设置失败不妨碍维护 GitHub 凭据。 -->
    <GitHubSettingsPanel />
  </section>
</template>
