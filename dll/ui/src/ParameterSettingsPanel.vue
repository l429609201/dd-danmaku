<script setup>
import { ref } from 'vue'
import FrontendDefaultsPanel from './FrontendDefaultsPanel.vue'
import ParameterFilesPanel from './ParameterFilesPanel.vue'
import ProxySettingsPanel from './ProxySettingsPanel.vue'
const active = ref('files')
</script>

<template>
  <section>
    <h2>用户配置</h2>
    <p>管理用户播放器参数、全局及用户默认值，以及本地中转 API。用户参数按所选用户保存，本地中转 API 对当前 Emby 实例生效。</p>
    <!-- 各面板独立保存；标签页加载后持续挂载，切换时保留未保存草稿。 -->
    <el-tabs v-model="active">
      <el-tab-pane label="用户完整配置" name="files">
        <ParameterFilesPanel />
      </el-tab-pane>
      <el-tab-pane label="默认配置（全局／用户）" name="defaults" lazy>
        <FrontendDefaultsPanel />
      </el-tab-pane>
      <el-tab-pane label="本地中转 API" name="proxy" lazy>
        <ProxySettingsPanel />
      </el-tab-pane>
    </el-tabs>
  </section>
</template>

<style scoped>
p { color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.6; }
</style>
