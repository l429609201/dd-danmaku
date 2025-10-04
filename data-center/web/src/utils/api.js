/**
 * API工具函数
 */

/**
 * 获取认证头
 */
export function getAuthHeaders() {
  const token = localStorage.getItem('access_token')
  const tokenType = localStorage.getItem('token_type') || 'bearer'
  
  if (token) {
    return {
      'Authorization': `${tokenType.charAt(0).toUpperCase() + tokenType.slice(1)} ${token}`
    }
  }
  
  return {}
}

/**
 * 发送认证请求
 */
export async function authFetch(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
    ...(options.headers || {})
  }

  const response = await fetch(url, {
    ...options,
    headers
  })

  // 如果返回401，清除本地令牌并跳转到登录页
  if (response.status === 401) {
    console.warn('JWT令牌已过期或无效，正在跳转到登录页...')
    localStorage.removeItem('access_token')
    localStorage.removeItem('token_type')

    // 立即跳转到登录页
    window.location.href = '/login'
    return response
  }

  return response
}

/**
 * 检查是否已登录
 */
export function isLoggedIn() {
  return !!localStorage.getItem('access_token')
}

/**
 * 登出
 */
export function logout() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('token_type')
  window.location.href = '/login'
}
