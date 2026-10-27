<template>
  <el-aside
    :width="sidebarWidth"
    class="sidebar"
    :class="{
      'sidebar--collapsed': themeStore.sidebarCollapsed && !themeStore.isMobile,
      'sidebar--mobile': themeStore.isMobile,
      'sidebar--mobile-open': themeStore.mobileMenuOpen
    }"
  >
    <!-- 品牌 Logo -->
    <div class="sidebar__brand">
      <el-icon class="brand-icon"><DataLine /></el-icon>
      <span v-show="!themeStore.sidebarCollapsed || themeStore.isMobile" class="brand-text">
        数据交互中心
      </span>
    </div>

    <!-- 菜单 -->
    <el-menu
      :default-active="$route.path"
      router
      class="sidebar__menu"
      :collapse="themeStore.sidebarCollapsed && !themeStore.isMobile"
      @select="handleMenuSelect"
    >
      <!-- 概览 -->
      <el-menu-item-group title="概览">
        <el-menu-item index="/">
          <el-icon><DataLine /></el-icon>
          <span>仪表盘</span>
        </el-menu-item>
      </el-menu-item-group>

      <!-- Worker -->
      <el-menu-item-group title="Worker">
        <el-menu-item index="/control">
          <el-icon><Connection /></el-icon>
          <span>连接与控制</span>
        </el-menu-item>
        <el-menu-item index="/worker-logs">
          <el-icon><Document /></el-icon>
          <span>Worker 日志</span>
        </el-menu-item>
      </el-menu-item-group>

      <!-- 缓存 -->
      <el-menu-item-group title="缓存">
        <el-menu-item index="/api-cache">
          <el-icon><Box /></el-icon>
          <span>API 缓存</span>
        </el-menu-item>
        <el-menu-item index="/comment-store">
          <el-icon><ChatDotSquare /></el-icon>
          <span>弹幕存储</span>
        </el-menu-item>
      </el-menu-item-group>

      <!-- 媒体库 -->
      <el-menu-item-group title="媒体库">
        <el-menu-item index="/entities">
          <el-icon><Film /></el-icon>
          <span>番剧列表</span>
        </el-menu-item>
        <el-menu-item index="/episodes">
          <el-icon><VideoPlay /></el-icon>
          <span>剧集列表</span>
        </el-menu-item>
        <el-menu-item index="/media-library">
          <el-icon><FolderOpened /></el-icon>
          <span>媒体库</span>
        </el-menu-item>
        <el-menu-item index="/alias-review">
          <el-icon><Edit /></el-icon>
          <span>别名审核</span>
        </el-menu-item>
      </el-menu-item-group>

      <!-- 监控 -->
      <el-menu-item-group title="监控">
        <el-menu-item index="/ip-stats">
          <el-icon><Cpu /></el-icon>
          <span>IP 统计</span>
        </el-menu-item>
        <el-menu-item index="/runtime-events">
          <el-icon><Bell /></el-icon>
          <span>运行事件</span>
        </el-menu-item>
        <el-menu-item index="/db-stats">
          <el-icon><DataAnalysis /></el-icon>
          <span>数据库统计</span>
        </el-menu-item>
      </el-menu-item-group>

      <!-- 密钥与规则 -->
      <el-menu-item-group title="密钥与规则">
        <el-menu-item index="/key-pool">
          <el-icon><Key /></el-icon>
          <span>密钥池</span>
        </el-menu-item>
        <el-menu-item index="/sign-key-pool">
          <el-icon><Lock /></el-icon>
          <span>签名密钥</span>
        </el-menu-item>
        <el-menu-item index="/ip-rules">
          <el-icon><Filter /></el-icon>
          <span>IP 规则</span>
        </el-menu-item>
        <el-menu-item index="/ua-rules">
          <el-icon><Monitor /></el-icon>
          <span>UA 规则</span>
        </el-menu-item>
        <el-menu-item index="/oauth-config">
          <el-icon><Link /></el-icon>
          <span>OAuth 配置</span>
        </el-menu-item>
      </el-menu-item-group>

      <!-- 清理与用户 -->
      <el-menu-item-group title="清理与用户">
        <el-menu-item index="/cleanup">
          <el-icon><Delete /></el-icon>
          <span>清理策略</span>
        </el-menu-item>
        <el-menu-item index="/users">
          <el-icon><User /></el-icon>
          <span>用户管理</span>
        </el-menu-item>
      </el-menu-item-group>

      <!-- 设置 -->
      <el-menu-item-group title="设置">
        <el-menu-item index="/settings">
          <el-icon><Setting /></el-icon>
          <span>系统设置</span>
        </el-menu-item>
      </el-menu-item-group>
    </el-menu>

    <!-- 折叠按钮（桌面端）-->
    <div
      v-if="!themeStore.isMobile"
      class="sidebar__toggle"
      @click="themeStore.toggleSidebar()"
    >
      <el-icon>
        <DArrowLeft v-if="!themeStore.sidebarCollapsed" />
        <DArrowRight v-else />
      </el-icon>
    </div>
  </el-aside>
</template>

<script setup>
import { computed } from 'vue'
import { useThemeStore } from '@/stores/theme'
import {
  DataLine, Connection, Document, Box, ChatDotSquare,
  Film, VideoPlay, FolderOpened, Edit, Cpu, Bell,
  DataAnalysis, Key, Lock, Filter, Monitor, Link,
  Delete, User, Setting, DArrowLeft, DArrowRight
} from '@element-plus/icons-vue'

const themeStore = useThemeStore()

// 侧边栏宽度
const sidebarWidth = computed(() => {
  if (themeStore.isMobile) return '220px'
  return themeStore.sidebarCollapsed ? '64px' : '220px'
})

// 菜单选择处理（移动端自动关闭）
const handleMenuSelect = () => {
  if (themeStore.isMobile) {
    themeStore.closeMobileMenu()
  }
}
</script>

<style scoped>
.sidebar {
  height: 100vh;
  background-color: var(--color-bg-overlay);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  transition: width var(--transition-base);
  position: relative;
  overflow-y: auto;
  overflow-x: hidden;
}

/* 品牌 */
.sidebar__brand {
  height: var(--header-height);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  padding: 0 var(--spacing-md);
  border-bottom: 1px solid var(--color-border);
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text);
  flex-shrink: 0;
}

.brand-icon {
  font-size: 24px;
  color: var(--color-primary);
}

.brand-text {
  transition: opacity var(--transition-base);
}

.sidebar--collapsed .brand-text {
  opacity: 0;
  width: 0;
  overflow: hidden;
}

/* 菜单 */
.sidebar__menu {
  flex: 1;
  border-right: none;
  background-color: transparent;
}

.sidebar__menu :deep(.el-menu-item-group__title) {
  padding-left: 20px;
  color: var(--color-text-placeholder);
  font-size: 12px;
  text-transform: uppercase;
}

.sidebar--collapsed .sidebar__menu :deep(.el-menu-item-group__title) {
  opacity: 0;
  height: 0;
  padding: 0;
  overflow: hidden;
}

/* 折叠按钮 */
.sidebar__toggle {
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-top: 1px solid var(--color-border);
  cursor: pointer;
  color: var(--color-text-secondary);
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.sidebar__toggle:hover {
  background-color: var(--color-bg-elevated);
  color: var(--color-primary);
}

/* 移动端适配 */
.sidebar--mobile {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1001;
  transform: translateX(-100%);
  transition: transform var(--transition-base);
}

.sidebar--mobile.sidebar--mobile-open {
  transform: translateX(0);
}

@media (max-width: 768px) {
  .sidebar__brand {
    height: 56px;
  }
}
</style>
