<template>
  <div class="app-layout">
    <!-- 移动端遮罩 -->
    <div
      v-if="themeStore.isMobile && themeStore.mobileMenuOpen"
      class="layout-mask"
      @click="themeStore.closeMobileMenu()"
    ></div>

    <el-container class="layout-container">
      <!-- 侧边栏 -->
      <Sidebar />

      <el-container class="layout-main">
        <!-- 导航栏 -->
        <Navbar />

        <!-- 主内容区 -->
        <el-main class="layout-content">
          <router-view />
        </el-main>
      </el-container>
    </el-container>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useThemeStore } from '@/stores/theme'
import Sidebar from './Sidebar.vue'
import Navbar from './Navbar.vue'

const themeStore = useThemeStore()

// 响应式检测
const checkMobile = () => {
  themeStore.setMobile(window.innerWidth <= 768)
}

onMounted(() => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
})

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
})
</script>

<style scoped>
.app-layout {
  width: 100%;
  height: 100vh;
  overflow: hidden;
}

.layout-container {
  width: 100%;
  height: 100%;
}

.layout-main {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.layout-content {
  flex: 1;
  overflow-y: auto;
  background-color: var(--color-bg-page);
  padding: var(--spacing-lg);
}

/* 移动端遮罩 */
.layout-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  transition: opacity var(--transition-base);
}

/* 移动端适配 */
@media (max-width: 768px) {
  .layout-content {
    padding: var(--spacing-md);
  }
}
</style>
