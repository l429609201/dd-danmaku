<script setup>
import { onMounted, ref } from 'vue'
import { Setting, VideoPlay, Files, Connection, DataAnalysis } from '@element-plus/icons-vue'
import { api } from './api.js'
import PluginSettings from './PluginSettings.vue'
import AiServicePanel from './AiServicePanel.vue'
import ParameterSettingsPanel from './ParameterSettingsPanel.vue'
import RecordsPanel from './RecordsPanel.vue'
import MatchingPanel from './MatchingPanel.vue'
import DashboardPanel from './DashboardPanel.vue'
const version = ref('版本未知')
const active = ref('dashboard'), refresh = ref(0), authorized = ref(false), error = ref('')
// 管理 API 鉴权成功后才展示导航，普通用户只在 ede.js 中管理本人参数。
onMounted(async () => {
  try {
    await api.config()
    authorized.value = true
    // 版本读取失败不阻断已经通过鉴权的其他管理页面。
    try { const overview = await api.dashboard(); version.value = overview?.version || '版本未知' }
    catch { version.value = '版本未知' }
  }
  catch (e) { error.value = e.status === 403 ? '仅管理员可访问后台；请在 ede.js 播放器中维护自己的参数。' : e.message }
})
const sections = [
  { id: 'dashboard', label: '仪表盘', icon: DataAnalysis, component: DashboardPanel },
  { id: 'settings', label: '插件设置', icon: Setting, component: PluginSettings },
  { id: 'ai', label: 'AI 服务', icon: Connection, component: AiServicePanel },
  // 默认值与完整参数统一入口，避免两个顶级菜单造成重复配置的误解。
  { id: 'parameters', label: '参数设置', icon: Files, component: ParameterSettingsPanel },
  { id: 'records', label: '弹幕记录', icon: VideoPlay, component: RecordsPanel },
  { id: 'matching', label: '媒体匹配', icon: Connection, component: MatchingPanel },
]
</script>

<template>
  <div class="shell">
    <main class="main">
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <template v-if="authorized">
        <header class="topbar">
          <!-- 去掉重复品牌信息，将空间留给导航；刷新通过事件发送，不销毁缓存页面。 -->
          <nav class="top-nav" aria-label="功能导航"><button v-for="item in sections" :key="item.id" :class="['nav-item', { active: active === item.id }]" @click="active = item.id"><el-icon><component :is="item.icon" /></el-icon><span>{{ item.label }}</span></button></nav>
          <el-button v-if="active === 'dashboard'" @click="refresh++">刷新状态</el-button>
          <!-- 内联仓库图标避免向第三方图片服务器发送管理页面请求。 -->
          <a href="https://github.com/l429609201/dd-danmaku" target="_blank" rel="noopener noreferrer" aria-label="打开 GitHub 仓库" title="GitHub 仓库" class="version-badge">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.23c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.23 1.84 1.23 1.07 1.83 2.81 1.3 3.49.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.93 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.76.84 1.23 1.91 1.23 3.22 0 4.6-2.8 5.63-5.48 5.93.43.37.82 1.1.82 2.22v3.3c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z" /></svg><span>{{ version }}</span>
          </a>
        </header>
        <KeepAlive>
          <component :is="sections.find(item => item.id === active)?.component" :key="active" :refresh-token="refresh" />
        </KeepAlive>
        <footer>DD-Danmaku · 插件配置存储在当前 Emby 实例</footer>
      </template>
    </main>
  </div>
</template>
