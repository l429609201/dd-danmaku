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
    path: '/change-password',
    name: 'ChangePassword',
    component: () => import('../views/ChangePassword.vue'),
    meta: { title: '修改密码' }
  },
  {
    path: '/',
    component: () => import('../components/Layout.vue'),
    children: [
      {
        path: '',
        name: 'Dashboard',
        component: () => import('../views/Dashboard.vue'),
        meta: { title: '仪表板' }
      },
      {
        path: 'config',
        name: 'Config',
        component: () => import('../views/Config.vue'),
        meta: { title: '配置管理' }
      },
      {
        path: 'stats',
        name: 'Stats',
        component: () => import('../views/Stats.vue'),
        meta: { title: '统计数据' }
      },
      {
        path: 'logs',
        name: 'Logs',
        component: () => import('../views/Logs.vue'),
        meta: { title: '日志管理' }
      },
      {
        path: 'workers',
        name: 'WorkerManagement',
        component: () => import('../views/WorkerManagement.vue'),
        meta: { title: 'Worker管理' }
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
    document.title = `${to.meta.title} - DanDanPlay 数据交互中心`
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
