// Axios 请求封装
import axios from 'axios'
import { ElMessage, ElLoading } from 'element-plus'

// 创建 axios 实例
const request = axios.create({
  baseURL: '/api/v2', // 基础 URL
  timeout: 30000, // 30 秒超时
  headers: {
    'Content-Type': 'application/json'
  }
})

// 全局 loading 实例
let loadingInstance = null
let loadingCount = 0

// 显示 loading
function showLoading() {
  if (loadingCount === 0) {
    loadingInstance = ElLoading.service({
      lock: true,
      text: '加载中...',
      background: 'rgba(0, 0, 0, 0.7)'
    })
  }
  loadingCount++
}

// 隐藏 loading
function hideLoading() {
  loadingCount--
  if (loadingCount <= 0) {
    loadingCount = 0
    loadingInstance?.close()
    loadingInstance = null
  }
}

// 请求拦截器
request.interceptors.request.use(
  (config) => {
    // 显示 loading（除非明确禁用）
    if (config.showLoading !== false) {
      showLoading()
    }

    // 添加 token（如果存在）
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }

    return config
  },
  (error) => {
    hideLoading()
    return Promise.reject(error)
  }
)

// 响应拦截器
request.interceptors.response.use(
  (response) => {
    hideLoading()

    // 直接返回 data
    return response.data
  },
  (error) => {
    hideLoading()

    // 处理各种错误情况
    let message = '请求失败'

    if (error.response) {
      const { status, data } = error.response

      switch (status) {
        case 400:
          message = data?.message || '请求参数错误'
          break
        case 401:
          message = '未授权，请重新登录'
          // 清除 token 并跳转登录页
          localStorage.removeItem('token')
          localStorage.removeItem('user')
          window.location.href = '/login'
          break
        case 403:
          message = '拒绝访问'
          break
        case 404:
          message = '请求的资源不存在'
          break
        case 500:
          message = data?.message || '服务器内部错误'
          break
        case 502:
          message = '网关错误'
          break
        case 503:
          message = '服务不可用'
          break
        case 504:
          message = '网关超时'
          break
        default:
          message = data?.message || `请求失败 (${status})`
      }
    } else if (error.request) {
      // 请求已发出，但没有收到响应
      message = '网络错误，请检查您的网络连接'
    } else {
      // 请求配置出错
      message = error.message || '请求配置错误'
    }

    // 显示错误消息（除非明确禁用）
    if (error.config?.showError !== false) {
      ElMessage.error(message)
    }

    return Promise.reject(error)
  }
)

// 导出请求方法
export default request

// 便捷方法
export const get = (url, params, config = {}) => {
  return request.get(url, { params, ...config })
}

export const post = (url, data, config = {}) => {
  return request.post(url, data, config)
}

export const put = (url, data, config = {}) => {
  return request.put(url, data, config)
}

export const del = (url, params, config = {}) => {
  return request.delete(url, { params, ...config })
}

// 批量请求
export const all = (requests) => {
  return Promise.all(requests)
}

// 不显示 loading 的请求
export const requestWithoutLoading = (config) => {
  return request({ ...config, showLoading: false })
}

// 不显示错误提示的请求
export const requestWithoutError = (config) => {
  return request({ ...config, showError: false })
}
