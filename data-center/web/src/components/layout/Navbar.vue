<template>
  <el-header class="navbar" :height="navbarHeight">
    <!-- 移动端菜单按钮 -->
    <div v-if="themeStore.isMobile" class="navbar__hamburger" @click="themeStore.toggleMobileMenu()">
      <el-icon><Menu /></el-icon>
    </div>

    <!-- 面包屑 -->
    <el-breadcrumb separator="/" class="navbar__breadcrumb">
      <el-breadcrumb-item :to="{ path: '/' }">首页</el-breadcrumb-item>
      <el-breadcrumb-item v-for="item in breadcrumbs" :key="item.path">
        {{ item.title }}
      </el-breadcrumb-item>
    </el-breadcrumb>

    <div class="navbar__spacer"></div>

    <!-- 主题切换按钮 -->
    <el-tooltip :content="themeStore.isDark ? '切换到明亮模式' : '切换到暗色模式'" placement="bottom">
      <div class="navbar__action" @click="themeStore.toggleTheme()">
        <el-icon>
          <Sunny v-if="themeStore.isDark" />
          <Moon v-else />
        </el-icon>
      </div>
    </el-tooltip>

    <!-- 用户下拉菜单 -->
    <el-dropdown @command="handleCommand" trigger="click" class="navbar__user">
      <div class="navbar__action navbar__action--user">
        <el-icon><User /></el-icon>
        <span v-if="!themeStore.isMobile" class="username">{{ username || '用户' }}</span>
        <el-icon class="dropdown-icon"><ArrowDown /></el-icon>
      </div>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="password">
            <el-icon><Lock /></el-icon>
            修改密码
          </el-dropdown-item>
          <el-dropdown-item command="logout" divided>
            <el-icon><SwitchButton /></el-icon>
            退出登录
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </el-header>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { useThemeStore } from '@/stores/theme'
import {
  Menu, Sunny, Moon, User, ArrowDown, Lock, SwitchButton
} from '@element-plus/icons-vue'
import { get } from '@/utils/request'
import { logout } from '@/utils/api'

const router = useRouter()
const route = useRoute()
const themeStore = useThemeStore()

const username = ref('')

// 响应式高度
const navbarHeight = computed(() => {
  return themeStore.isMobile ? '56px' : '60px'
})

// 面包屑映射
const routeTitleMap = {
  '/': '仪表盘',
  '/control': '连接与控制',
  '/worker-logs': 'Worker 日志',
  '/api-cache': 'API 缓存',
  '/comment-store': '弹幕存储',
  '/entities': '番剧列表',
  '/episodes': '剧集列表',
  '/media-library': '媒体库',
  '/alias-review': '别名审核',
  '/ip-stats': 'IP 统计',
  '/runtime-events': '运行事件',
  '/db-stats': '数据库统计',
  '/key-pool': '密钥池',
  '/sign-key-pool': '签名密钥',
  '/ip-rules': 'IP 规则',
  '/ua-rules': 'UA 规则',
  '/oauth-config': 'OAuth 配置',
  '/cleanup': '清理策略',
  '/users': '用户管理',
  '/settings': '系统设置',
}

// 面包屑
const breadcrumbs = computed(() => {
  const path = route.path
  if (path === '/') return []
  
  const title = routeTitleMap[path] || '未知页面'
  return [{ path, title }]
})

// 下拉菜单命令
const handleCommand = (cmd) => {
  if (cmd === 'password') {
    // 触发密码修改弹窗
    if (route.path === '/settings') {
      window.dispatchEvent(new CustomEvent('show-password-modal'))
    } else {
      router.push('/settings').then(() => {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('show-password-modal'))
        }, 120)
      })
    }
  } else if (cmd === 'logout') {
    ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      confirmButtonText: '退出',
      cancelButtonText: '取消',
      type: 'warning',
    })
      .then(() => logout())
      .catch(() => {})
  }
}

// 获取用户信息
const fetchUserInfo = async () => {
  const token = localStorage.getItem('access_token')
  if (!token) {
    router.push('/login')
    return
  }

  try {
    const result = await get('/api/v2/auth/me')
    username.value = (result.data && result.data.username) || '用户'
  } catch (error) {
    console.error('获取用户信息异常:', error)
  }
}

onMounted(() => {
  fetchUserInfo()
})
</script>

<style scoped>
.navbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: 0 var(--spacing-lg);
  background-color: var(--color-bg-overlay);
  border-bottom: 1px solid var(--color-border);
  box-shadow: var(--shadow-sm);
}

/* 移动端菜单按钮 */
.navbar__hamburger {
  font-size: 22px;
  cursor: pointer;
  color: var(--color-text);
  display: flex;
  align-items: center;
}

/* 面包屑 */
.navbar__breadcrumb {
  font-size: 14px;
}

.navbar__breadcrumb :deep(.el-breadcrumb__item) {
  color: var(--color-text-secondary);
}

.navbar__breadcrumb :deep(.el-breadcrumb__item:last-child .el-breadcrumb__inner) {
  color: var(--color-text);
  font-weight: 500;
}

/* 间隔 */
.navbar__spacer {
  flex: 1;
}

/* 操作按钮 */
.navbar__action {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--color-text);
  transition: all var(--transition-fast);
  font-size: 18px;
}

.navbar__action:hover {
  background-color: var(--color-bg-elevated);
  color: var(--color-primary);
}

.navbar__action--user {
  font-size: 14px;
}

.username {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dropdown-icon {
  font-size: 12px;
  transition: transform var(--transition-fast);
}

.navbar__user:hover .dropdown-icon {
  transform: rotate(180deg);
}

/* 移动端适配 */
@media (max-width: 768px) {
  .navbar {
    padding: 0 var(--spacing-md);
    gap: var(--spacing-sm);
  }

  .navbar__breadcrumb {
    display: none;
  }
}
</style>
