<script setup>
import { useUiRef } from './useUiState.js'
import FrontendDefaultsPanel from './FrontendDefaultsPanel.vue'
import ParameterFilesPanel from './ParameterFilesPanel.vue'
import ProxySettingsPanel from './ProxySettingsPanel.vue'
const active = useUiRef('parameter-page', 'files', value => ['files', 'defaults', 'proxy'].includes(value))
</script>

<template>
  <section>
    <h2>用户配置</h2>
    <p>用户配置的完整视图与简化视图读写同一份用户参数。全局模板在用户参数首次初始化时复制，缺失字段继续继承模板；实例共享来源（Emby 中转）独立配置，需用户引用并启用，不影响个人独立源。</p>
    <!-- 各面板独立保存；标签页加载后持续挂载，切换时保留未保存草稿。 -->
    <el-tabs v-model="active">
      <el-tab-pane label="用户配置（完整视图）" name="files">
        <ParameterFilesPanel :active="active === 'files'" />
      </el-tab-pane>
      <el-tab-pane label="全局模板／用户配置（简化视图）" name="defaults" lazy>
        <FrontendDefaultsPanel :active="active === 'defaults'" />
      </el-tab-pane>
      <el-tab-pane label="实例共享来源（Emby 中转）" name="proxy" lazy>
        <ProxySettingsPanel />
      </el-tab-pane>
    </el-tabs>
  </section>
</template>

<style scoped>
p { color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.6; }
</style>
