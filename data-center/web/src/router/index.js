import { createRouter, createWebHistory } from 'vue-router'

// 路由配置
const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue'),
    meta: { title: '登录', requiresAuth: false }
  },

  {
    path: '/',
    component: () => import('../components/Layout.vue'),
    children: [
      {
        path: '',
        name: 'Dashboard',
        component: () => import('../views/Dashboard.vue'),
        meta: { title: '概览' }
      },
      {
        path: 'control',
        name: 'Control',
        component: () => import('../views/Control.vue'),
        meta: { title: 'Worker 控制' }
      },
      {
        path: 'cache',
        name: 'ApiCache',
        component: () => import('../views/ApiCache.vue'),
        meta: { title: '响应缓存' }
      },
      {
        path: 'episodes',
        name: 'Episodes',
        component: () => import('../views/Episodes.vue'),
        meta: { title: '集数链接' }
      },
      {
        path: 'entities',
        name: 'Entities',
        component: () => import('../views/Entities.vue'),
        meta: { title: '实体索引' }
      },
      {
        path: 'ip-rules',
        name: 'IpRules',
        component: () => import('../views/IpRules.vue'),
        meta: { title: 'IP 黑白名单' }
      },
      {
        path: 'ip-stats',
        name: 'IpStats',
        component: () => import('../views/IpStats.vue'),
        meta: { title: 'IP 请求统计' }
      },
      {
        path: 'ua-rules',
        name: 'UaRules',
        component: () => import('../views/UaRules.vue'),
        meta: { title: 'UA 限流' }
      },
      {
        path: 'key-pool',
        name: 'KeyPool',
        component: () => import('../views/KeyPool.vue'),
        meta: { title: '密钥池' }
      },
      {
        path: 'worker-logs',
        name: 'WorkerLogs',
        component: () => import('../views/WorkerLogs.vue'),
        meta: { title: 'Worker 日志' }
      },
      {
        path: 'db-stats',
        name: 'DbStats',
        component: () => import('../views/DbStats.vue'),
        meta: { title: '数据库状态' }
      },
      {
        path: 'cleanup',
        name: 'Cleanup',
        component: () => import('../views/Cleanup.vue'),
        meta: { title: '数据清理' }
      },
      {
        path: 'comment-store',
        name: 'CommentStore',
        component: () => import('../views/CommentStore.vue'),
        meta: { title: '弹幕存储' }
      },
      {
        path: 'users',
        name: 'Users',
        component: () => import('../views/Users.vue'),
        meta: { title: '用户管理' }
      },
      {
        path: 'settings',
        name: 'Settings',
        component: () => import('../views/Settings.vue'),
        meta: { title: '系统设置' }
      },
      {
        path: 'runtime-events',
        name: 'RuntimeEvents',
        component: () => import('../views/RuntimeEvents.vue'),
        meta: { title: '运行日志' }
      }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 路由守卫
router.beforeEach(async (to, from, next) => {
  // 设置页面标题
  if (to.meta.title) {
    document.title = `${to.meta.title} - Worker 数据交互中心`
  }

  console.log('🛣️ 路由守卫:', {
    to: to.path,
    from: from.path,
    requiresAuth: to.meta.requiresAuth
  })

  // 检查认证状态
  if (to.meta.requiresAuth !== false) {
    const token = localStorage.getItem('access_token')
    console.log('🔐 检查认证状态:', { hasToken: !!token })

    if (!token) {
      console.warn('⚠️ 未找到令牌，跳转到登录页')
      next('/login')
    } else {
      // 已登录，允许访问
      console.log('✅ 令牌存在，允许访问')
      next()
    }
  } else {
    // 不需要认证的页面（如登录页）
    console.log('🔓 无需认证的页面')
    next()
  }
})

export default router
