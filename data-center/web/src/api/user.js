// 用户管理 API
import { get, post, put, del } from '@/utils/request'

/**
 * 获取用户列表
 * @param {Object} params - 查询参数
 * @param {number} params.page - 页码
 * @param {number} params.limit - 每页数量
 * @param {string} params.keyword - 搜索关键词
 * @returns {Promise<{total: number, list: Array}>}
 */
export function getUserList(params) {
  return get('/users', params)
}

/**
 * 获取用户详情
 * @param {number} id - 用户 ID
 * @returns {Promise<Object>}
 */
export function getUserDetail(id) {
  return get(`/users/${id}`)
}

/**
 * 创建用户
 * @param {Object} data - 用户数据
 * @param {string} data.username - 用户名
 * @param {string} data.password - 密码
 * @param {string} data.role - 角色
 * @returns {Promise<Object>}
 */
export function createUser(data) {
  return post('/users', data)
}

/**
 * 更新用户
 * @param {number} id - 用户 ID
 * @param {Object} data - 用户数据
 * @returns {Promise<Object>}
 */
export function updateUser(id, data) {
  return put(`/users/${id}`, data)
}

/**
 * 删除用户
 * @param {number} id - 用户 ID
 * @returns {Promise<void>}
 */
export function deleteUser(id) {
  return del(`/users/${id}`)
}

/**
 * 重置用户密码
 * @param {number} id - 用户 ID
 * @param {string} newPassword - 新密码
 * @returns {Promise<void>}
 */
export function resetUserPassword(id, newPassword) {
  return post(`/users/${id}/reset-password`, { newPassword })
}

/**
 * 获取用户 API Token 列表
 * @param {number} userId - 用户 ID
 * @returns {Promise<Array>}
 */
export function getUserTokens(userId) {
  return get(`/users/${userId}/tokens`)
}

/**
 * 创建用户 API Token
 * @param {number} userId - 用户 ID
 * @param {Object} data - Token 数据
 * @param {string} data.name - Token 名称
 * @param {number} data.expiresIn - 有效期（秒）
 * @returns {Promise<{token: string}>}
 */
export function createUserToken(userId, data) {
  return post(`/users/${userId}/tokens`, data)
}

/**
 * 删除用户 API Token
 * @param {number} userId - 用户 ID
 * @param {number} tokenId - Token ID
 * @returns {Promise<void>}
 */
export function deleteUserToken(userId, tokenId) {
  return del(`/users/${userId}/tokens/${tokenId}`)
}
