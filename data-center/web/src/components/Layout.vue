<template>
  <div class="layout">
    <!-- 顶部导航栏 -->
    <header class="header">
      <div class="header-left">
        <h2>⚡ Worker 数据交互中心</h2>
      </div>
      <div class="header-right">
        <div class="user-dropdown">
          <button @click="toggleDropdown" class="user-btn">
            👤 {{ username }} <span class="dropdown-arrow" :class="{ open: showDropdown }">▼</span>
          </button>
          <div v-if="showDropdown" class="dropdown-menu">
            <button @click="changePassword" class="dropdown-item">
              🔐 修改密码
            </button>
            <button @click="logout" class="dropdown-item logout-item">
              🚪 退出登录
            </button>
          </div>
        </div>
      </div>
    </header>

    <div class="content-wrapper">
      <!-- 左侧导航栏 -->
      <nav class="sidebar">
        <ul class="nav-menu">
          <li>
            <router-link to="/" class="nav-link" :class="{ active: $route.path === '/' }" @click="handleNavClick">
              📊 仪表板
            </router-link>
          </li>
          <li>
            <router-link to="/config" class="nav-link" :class="{ active: $route.path === '/config' }" @click="handleNavClick">
              ⚙️ 配置管理
            </router-link>
          </li>
          <li>
            <router-link to="/stats" class="nav-link" :class="{ active: $route.path === '/stats' }" @click="handleNavClick">
              📈 统计数据
            </router-link>
          </li>
          <li>
            <router-link to="/logs" class="nav-link" :class="{ active: $route.path === '/logs' }" @click="handleNavClick">
              📋 日志管理
            </router-link>
          </li>
          <li>
            <router-link to="/workers" class="nav-link" :class="{ active: $route.path === '/workers' }" @click="handleNavClick">
              🔧 Worker管理
            </router-link>
          </li>
        </ul>
      </nav>

      <!-- 主内容区域 -->
      <main class="main-content">
        <keep-alive>
          <router-view :key="routeKey" />
        </keep-alive>
      </main>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { logout as apiLogout, authFetch } from '../utils/api.js'

export default {
  name: 'Layout',
  setup() {
    const router = useRouter()
    const route = useRoute()
    const username = ref('')
    const showDropdown = ref(false)

    // 创建一个响应式的路由key，确保组件正确重新渲染
    const routeKey = computed(() => {
      return route.fullPath + Date.now()
    })

    const toggleDropdown = () => {
      showDropdown.value = !showDropdown.value
    }

    const closeDropdown = () => {
      showDropdown.value = false
    }

    const changePassword = () => {
      closeDropdown()
      // 跳转到设置页面并触发密码修改弹窗
      router.push('/settings?action=change-password')
    }

    const logout = () => {
      closeDropdown()
      if (confirm('确定要退出登录吗？')) {
        apiLogout()
      }
    }

    const handleNavClick = (event) => {
      // 强制关闭下拉菜单，确保路由切换时状态正确
      closeDropdown()

      // 清理可能存在的定时器或异步操作
      if (window.currentPageCleanup) {
        window.currentPageCleanup()
      }

      // 强制垃圾回收（如果浏览器支持）
      if (window.gc) {
        setTimeout(() => window.gc(), 100)
      }
    }

    // 监听路由变化，确保每次切换都清理状态
    watch(route, (newRoute, oldRoute) => {
      if (newRoute.path !== oldRoute.path) {
        closeDropdown()
        // 清理之前页面的状态
        if (window.currentPageCleanup) {
          window.currentPageCleanup()
        }
      }
    })



    onMounted(async () => {
      // 检查登录状态
      const token = localStorage.getItem('access_token')
      if (!token) {
        console.warn('未找到访问令牌，跳转到登录页')
        router.push('/login')
        return
      }

      try {
        // 验证token是否有效
        const response = await authFetch('/auth/me')
        if (response.ok) {
          const userInfo = await response.json()
          username.value = userInfo.username || ''
        } else {
          console.warn('令牌验证失败，跳转到登录页')
          localStorage.removeItem('access_token')
          localStorage.removeItem('token_type')
          router.push('/login')
        }
      } catch (error) {
        console.error('验证用户信息失败:', error)
        router.push('/login')
      }
    })
    
    // 点击外部关闭下拉菜单
    onMounted(() => {
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.user-dropdown')) {
          showDropdown.value = false
        }
      })
    })

    return {
      username,
      showDropdown,
      routeKey,
      toggleDropdown,
      closeDropdown,
      changePassword,
      logout,
      handleNavClick
    }
  }
}
</script>

<style scoped>
.layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f5f5f5;
}

/* 顶部导航栏 */
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 24px;
  height: 64px;
  background: white;
  border-bottom: 1px solid #e0e0e0;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  z-index: 1000;
}

.header-left h2 {
  margin: 0;
  font-size: 20px;
  color: #333;
  font-weight: 600;
}

.header-right {
  display: flex;
  align-items: center;
}

.user-dropdown {
  position: relative;
}

.user-btn {
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  padding: 8px 16px;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 6px;
  transition: all 0.3s;
}

.user-btn:hover {
  background: #f0f0f0;
  color: #333;
}

.dropdown-arrow {
  transition: transform 0.3s;
  font-size: 12px;
}

.dropdown-arrow.open {
  transform: rotate(180deg);
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 1001;
  margin-top: 8px;
  min-width: 150px;
}

.dropdown-item {
  display: block;
  width: 100%;
  padding: 12px 16px;
  color: #333;
  text-decoration: none;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 14px;
  text-align: left;
  transition: background 0.3s;
  border-radius: 0;
}

.dropdown-item:first-child {
  border-radius: 8px 8px 0 0;
}

.dropdown-item:last-child {
  border-radius: 0 0 8px 8px;
}

.dropdown-item:hover {
  background: #f0f0f0;
}

.logout-item {
  color: #e74c3c;
  border-top: 1px solid #e0e0e0;
}

.logout-item:hover {
  background: #fef2f2;
  color: #dc2626;
}

/* 内容包装器 */
.content-wrapper {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* 左侧导航栏 */
.sidebar {
  width: 240px;
  background: white;
  border-right: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
}

.nav-menu {
  list-style: none;
  padding: 16px 0;
  margin: 0;
  flex: 1;
}

.nav-menu li {
  margin: 0 12px 4px 12px;
}

.nav-link {
  display: block;
  padding: 12px 16px;
  color: #666;
  text-decoration: none;
  transition: all 0.3s;
  font-size: 14px;
  border-radius: 8px;
  font-weight: 500;
}

.nav-link:hover {
  background: #f0f0f0;
  color: #333;
}

.nav-link.active {
  background: #e3f2fd;
  color: #1976d2;
  font-weight: 600;
}

/* 主内容区域 */
.main-content {
  flex: 1;
  overflow-y: auto;
  background: #f5f5f5;
}
</style>
