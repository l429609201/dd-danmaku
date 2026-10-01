<script setup>
import { onMounted, ref } from 'vue'
import { api } from './api.js'
// 更新凭据独立保存，避免与运行设置互相覆盖。
import GitHubSettingsPanel from './GitHubSettingsPanel.vue'
import SelectionSettingsPanel from './SelectionSettingsPanel.vue'
const config = ref(null), playback = ref(null), busy = ref(false), error = ref(''), message = ref('')
async function load() {
  busy.value = true; error.value = ''
  try { [config.value, playback.value] = await Promise.all([api.config(), api.playbackSettings()]) }
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
async function savePlayback() {
  busy.value = true; error.value = ''; message.value = ''
  try { playback.value = await api.savePlaybackSettings(playback.value); message.value = 'XML 联动设置已保存' }
  catch (e) { error.value = e.message }
  finally { busy.value = false }
}
onMounted(load)
</script>

<template>
  <section class="panel" v-loading="busy">
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-alert v-if="message" :title="message" type="success" :closable="false" />
    <el-button v-if="!config || !playback" @click="load">重新加载设置</el-button>
    <el-card v-if="config" shadow="never">
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
    <el-card v-if="playback" shadow="never">
      <template #header>服务器 XML 联动</template>
      <el-form label-width="170px" :disabled="busy">
        <el-form-item label="XML 联动总开关"><el-switch v-model="playback.enabled" inline-prompt active-text="开" inactive-text="关" :width="52" /></el-form-item>
        <el-form-item v-for="[key, label] in [['readEnabled', '允许读取 XML'], ['writeEnabled', '允许管理员写入'], ['preferLocal', '优先本地 XML'], ['autoSave', '管理员自动保存']]" :key="key" :label="label">
          <el-switch v-model="playback[key]" inline-prompt active-text="开" inactive-text="关" :width="52" :disabled="!playback.enabled || (key === 'preferLocal' && !playback.readEnabled) || (key === 'autoSave' && !playback.writeEnabled)" />
        </el-form-item>
        <p>本地 XML 位于视频旁，读取失败回退原有匹配流程。自动保存仅管理员可用，不覆盖已有文件。</p>
        <p>普通用户只通过 ede.js 维护自己的参数文件，不具备后台弹幕管理或共享 XML 写入权限。</p>
        <p>STRM 旁 XML 可被扫描统计，但当前不支持通过本插件读写。定时刷新尚未实现，不提供无效开关。</p>
        <el-button type="primary" @click="savePlayback">保存 XML 联动设置</el-button>
      </el-form>
    </el-card>
    <!-- 授权策略独立保存，避免与运行设置或 XML 联动设置互相覆盖。 -->
    <SelectionSettingsPanel />
    <!-- 更新设置独立加载，XML 设置失败不妨碍维护 GitHub 凭据。 -->
    <GitHubSettingsPanel />
  </section>
</template>
