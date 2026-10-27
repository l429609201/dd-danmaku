// 认证相关 API
import { get, post } from '@/utils/request'

/**
 * 用户登录
 * @param {string} username - 用户名
 * @param {string} password - 密码
 * @returns {Promise<{token: string, user: object}>}
 */
export function login(username, password) {
  return post('/auth/login', { username, password })
}

/**
 * 用户登出
 * @returns {Promise<void>}
 */
export function logout() {
  return post('/auth/logout')
}

/**
 * 获取当前用户信息
 * @returns {Promise<{id: number, username: string, role: string}>}
 */
export function getUserInfo() {
  return get('/auth/me')
}

/**
 * 修改密码
 * @param {string} oldPassword - 旧密码
 * @param {string} newPassword - 新密码
 * @returns {Promise<void>}
 */
export function changePassword(oldPassword, newPassword) {
  return post('/auth/change-password', { oldPassword, newPassword })
}

/**
 * 刷新 token
 * @returns {Promise<{token: string}>}
 */
export function refreshToken() {
  return post('/auth/refresh')
}
