<script setup>
import { ref } from 'vue'
import FrontendDefaultsPanel from './FrontendDefaultsPanel.vue'
import ParameterFilesPanel from './ParameterFilesPanel.vue'
const active = ref('files')
</script>

<template>
  <section>
    <h2>参数设置</h2>
    <p>用户完整配置包含弹幕 API、源凭据和同步设置；默认配置维护全局及用户默认值。两类配置保留各自的保存范围，不自动迁移或覆盖。</p>
    <!-- 合并导航而不合并存储；两个编辑器持续挂载，切换时保留未保存草稿。 -->
    <el-tabs v-model="active">
      <el-tab-pane label="用户完整配置（含弹幕 API）" name="files">
        <ParameterFilesPanel />
      </el-tab-pane>
      <el-tab-pane label="默认配置（全局／用户）" name="defaults" lazy>
        <FrontendDefaultsPanel />
      </el-tab-pane>
    </el-tabs>
  </section>
</template>

<style scoped>
p { color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.6; }
</style>
