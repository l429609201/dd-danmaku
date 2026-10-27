// API 模块统一导出
export * as authApi from './auth'
export * as userApi from './user'
export * as animeApi from './anime'
export * as cacheApi from './cache'
export * as workerApi from './worker'
export * as systemApi from './system'

// 也可以直接导入单个函数
// import { login, logout } from '@/api/auth'
// import { getUserList } from '@/api/user'

// 或者导入整个模块
// import { authApi } from '@/api'
// authApi.login(username, password)
