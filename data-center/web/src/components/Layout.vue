<template>
  <el-container class="layout">
    <!-- 移动端抽屉遮罩：点击关闭侧边栏 -->
    <div v-if="isMobile && drawerOpen" class="sidebar-mask" @click="drawerOpen = false"></div>

    <el-aside width="220px" class="sidebar"
              :class="{ 'sidebar--mobile': isMobile, 'sidebar--open': drawerOpen }">
      <div class="brand">⚡ 数据交互中心</div>
      <el-menu :default-active="$route.path" router class="side-menu" :collapse="false"
               @select="onMenuSelect">
        <el-menu-item-group title="概览">
          <el-menu-item index="/"><el-icon><DataLine /></el-icon><span>仪表盘</span></el-menu-item>
        </el-menu-item-group>
        <el-menu-item-group title="Worker">
          <el-menu-item index="/control"><el-icon><Connection /></el-icon><span>连接与控制</span></el-menu-item>
        </el-menu-item-group>
        <el-menu-item-group title="数据情况">
          <el-menu-item index="/media"><el-icon><Film /></el-icon><span>媒体库</span></el-menu-item>
          <el-menu-item index="/cache"><el-icon><Box /></el-icon><span>响应缓存</span></el-menu-item>
          <el-menu-item index="/episodes"><el-icon><VideoCamera /></el-icon><span>集数链接</span></el-menu-item>
          <el-menu-item index="/entities"><el-icon><Collection /></el-icon><span>实体索引</span></el-menu-item>
          <el-menu-item index="/comment-store"><el-icon><ChatLineSquare /></el-icon><span>弹幕存储</span></el-menu-item>
        </el-menu-item-group>
        <el-menu-item-group title="访问控制">
          <el-menu-item index="/ip-rules"><el-icon><Lock /></el-icon><span>IP 黑白名单</span></el-menu-item>
          <el-menu-item index="/ip-stats"><el-icon><TrendCharts /></el-icon><span>IP 请求统计</span></el-menu-item>
          <el-menu-item index="/ua-rules"><el-icon><Odometer /></el-icon><span>UA 限流</span></el-menu-item>
          <el-menu-item index="/key-pool"><el-icon><Ticket /></el-icon><span>密钥池</span></el-menu-item>
        </el-menu-item-group>
        <el-menu-item-group title="系统">
          <el-menu-item index="/worker-logs"><el-icon><Monitor /></el-icon><span>Worker 日志</span></el-menu-item>
          <el-menu-item index="/db-stats"><el-icon><Coin /></el-icon><span>数据库状态</span></el-menu-item>
          <el-menu-item index="/cleanup"><el-icon><Delete /></el-icon><span>数据清理</span></el-menu-item>
          <el-menu-item index="/runtime-events"><el-icon><Document /></el-icon><span>运行日志</span></el-menu-item>
          <el-menu-item index="/users"><el-icon><User /></el-icon><span>用户与 Token</span></el-menu-item>
          <el-menu-item index="/settings"><el-icon><Setting /></el-icon><span>系统设置</span></el-menu-item>
        </el-menu-item-group>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="header">
        <!-- 移动端汉堡按钮：切换侧边栏抽屉 -->
        <el-icon v-if="isMobile" class="hamburger" @click="drawerOpen = !drawerOpen"><Fold /></el-icon>
        <div class="header-title">{{ $route.meta.title || '控制台' }}</div>
        <div class="header-spacer"></div>
        <el-dropdown trigger="click" @command="onCommand">
          <span class="user-trigger">
            <el-icon><Avatar /></el-icon>
            {{ username || '用户' }}
            <el-icon><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="password"><el-icon><Key /></el-icon> 修改密码</el-dropdown-item>
              <el-dropdown-item command="logout" divided><el-icon><SwitchButton /></el-icon> 退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </el-header>

      <el-main class="main-content">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { logout as apiLogout, authFetch } from '../utils/api.js'

export default {
  name: 'Layout',
  setup() {
    const router = useRouter()
    const username = ref('')
    // 移动端响应式：窄屏侧边栏改为抽屉
    const isMobile = ref(false)
    const drawerOpen = ref(false)
    const checkMobile = () => {
      isMobile.value = window.innerWidth <= 768
      if (!isMobile.value) drawerOpen.value = false // 切回宽屏时复位
    }
    // 移动端点击菜单后自动收起抽屉
    const onMenuSelect = () => { if (isMobile.value) drawerOpen.value = false }

    const triggerPasswordModal = () => {
      if (router.currentRoute.value.path === '/settings') {
        window.dispatchEvent(new CustomEvent('show-password-modal'))
      } else {
        router.push('/settings').then(() => {
          setTimeout(() => window.dispatchEvent(new CustomEvent('show-password-modal')), 120)
        })
      }
    }

    const onCommand = (cmd) => {
      if (cmd === 'password') {
        triggerPasswordModal()
      } else if (cmd === 'logout') {
        ElMessageBox.confirm('确定要退出登录吗？', '提示', {
          confirmButtonText: '退出', cancelButtonText: '取消', type: 'warning',
        }).then(() => apiLogout()).catch(() => {})
      }
    }

    onMounted(async () => {
      checkMobile()
      window.addEventListener('resize', checkMobile)
      const token = localStorage.getItem('access_token')
      if (!token) {
        router.push('/login')
        return
      }
      try {
        const response = await authFetch('/api/v2/auth/me')
        if (response.ok) {
          const result = await response.json()
          username.value = (result.data && result.data.username) || ''
        } else {
          localStorage.removeItem('access_token')
          localStorage.removeItem('token_type')
          router.push('/login')
        }
      } catch (error) {
        console.error('验证用户信息失败:', error)
        router.push('/login')
      }
    })

    onUnmounted(() => window.removeEventListener('resize', checkMobile))

    return { username, onCommand, isMobile, drawerOpen, onMenuSelect }
  }
}
</script>

<style scoped>
.layout {
  height: 100vh;
}
.sidebar {
  background: #001529;
  overflow-x: hidden;
}
.brand {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 1px;
}
.side-menu {
  border-right: none;
  background: transparent;
}
/* 深色侧边栏菜单配色 */
.side-menu :deep(.el-menu-item),
.side-menu :deep(.el-menu-item-group__title) {
  color: rgba(255, 255, 255, 0.65);
}
.side-menu :deep(.el-menu-item.is-active) {
  color: #fff;
  background: var(--el-color-primary);
}
.side-menu :deep(.el-menu-item:hover) {
  background: rgba(255, 255, 255, 0.08);
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  padding: 0 24px;
}
.header-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--app-text);
}
.user-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--app-text);
  outline: none;
}
.main-content {
  background: var(--app-bg);
  padding: 0;
}
.header-spacer {
  flex: 1;
}
.hamburger {
  font-size: 22px;
  cursor: pointer;
  margin-right: 12px;
  color: var(--app-text);
}
/* 移动端抽屉遮罩 */
.sidebar-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 1000;
}
/* 窄屏：侧边栏改为抽屉，默认滑出屏幕外 */
@media (max-width: 768px) {
  .sidebar--mobile {
    position: fixed;
    top: 0;
    left: 0;
    height: 100vh;
    z-index: 1001;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
  }
  .sidebar--mobile.sidebar--open {
    transform: translateX(0);
  }
  .header {
    padding: 0 14px;
  }
}
</style>
