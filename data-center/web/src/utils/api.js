/**
 * API工具函数
 */

/**
 * 获取认证头
 */
export function getAuthHeaders() {
  const token = localStorage.getItem('access_token')
  const tokenType = localStorage.getItem('token_type') || 'bearer'

  console.log('🔍 获取认证头:', {
    hasToken: !!token,
    tokenLength: token ? token.length : 0,
    tokenType: tokenType
  })

  if (token) {
    const authHeader = `${tokenType.charAt(0).toUpperCase() + tokenType.slice(1)} ${token}`
    console.log('🔑 生成认证头:', authHeader.substring(0, 20) + '...')
    return {
      'Authorization': authHeader
    }
  }

  console.warn('⚠️ 未找到访问令牌')
  return {}
}

/**
 * 发送认证请求
 */
export async function authFetch(url, options = {}) {
  // 自动添加API前缀（但不为worker-api路由添加）
  let finalUrl = url
  if (url.startsWith('/') && !url.startsWith('/api/') && !url.startsWith('/worker-api/')) {
    finalUrl = `/api${url}`
  }

  const authHeaders = getAuthHeaders()
  const headers = {
    'Content-Type': 'application/json',
    ...authHeaders,
    ...(options.headers || {})
  }

  console.log('🌐 发送认证请求:', {
    originalUrl: url,
    finalUrl,
    method: options.method || 'GET',
    hasAuth: !!authHeaders.Authorization,
    headers: Object.keys(headers)
  })

  const response = await fetch(finalUrl, {
    ...options,
    headers
  })

  console.log('📡 收到响应:', {
    url,
    status: response.status,
    statusText: response.statusText
  })

  // 如果返回401，清除本地令牌并跳转到登录页
  if (response.status === 401) {
    console.warn('🚫 JWT令牌已过期或无效，正在跳转到登录页...')

    // 清除本地令牌
    localStorage.removeItem('access_token')
    localStorage.removeItem('token_type')

    // 直接跳转到登录页
    window.location.href = '/login'
    return response
  }

  return response
}

/**
 * 检查是否已登录
 */
export function isLoggedIn() {
  const token = localStorage.getItem('access_token')
  if (!token) {
    return false
  }

  // 简单检查token格式（JWT应该有3个部分）
  const parts = token.split('.')
  if (parts.length !== 3) {
    console.warn('⚠️ Token格式无效')
    localStorage.removeItem('access_token')
    localStorage.removeItem('token_type')
    return false
  }

  return true
}

/**
 * 登出
 */
export function logout() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('token_type')
  window.location.href = '/'
}
