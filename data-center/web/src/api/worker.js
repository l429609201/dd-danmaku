// Worker Bridge 管理 API
import { get, post, del } from '@/utils/request'

// ========== Control Node 管理 ==========

/**
 * 获取 Worker 节点列表
 * @param {Object} params - 查询参数
 * @param {number} params.page - 页码
 * @param {number} params.limit - 每页数量
 * @param {string} params.status - 状态筛选（online/offline）
 * @returns {Promise<{total: number, list: Array}>}
 */
export function getNodeList(params) {
  return get('/nodes', params)
}

/**
 * 获取节点详情
 * @param {string} nodeId - 节点 ID
 * @returns {Promise<Object>}
 */
export function getNodeDetail(nodeId) {
  return get(`/nodes/${nodeId}`)
}

/**
 * 注册节点
 * @param {Object} data - 节点数据
 * @param {string} data.nodeId - 节点 ID
 * @param {string} data.hostname - 主机名
 * @param {Object} data.metadata - 元数据
 * @returns {Promise<Object>}
 */
export function registerNode(data) {
  return post('/nodes', data)
}

/**
 * 删除节点
 * @param {string} nodeId - 节点 ID
 * @returns {Promise<void>}
 */
export function deleteNode(nodeId) {
  return del(`/nodes/${nodeId}`)
}

/**
 * 更新节点状态
 * @param {string} nodeId - 节点 ID
 * @param {string} status - 状态（online/offline）
 * @returns {Promise<Object>}
 */
export function updateNodeStatus(nodeId, status) {
  return post(`/nodes/${nodeId}/status`, { status })
}

/**
 * 获取节点统计信息
 * @returns {Promise<{total: number, online: number, offline: number}>}
 */
export function getNodeStats() {
  return get('/nodes/stats')
}

// ========== Control Message 管理 ==========

/**
 * 获取控制消息列表
 * @param {Object} params - 查询参数
 * @param {number} params.page - 页码
 * @param {number} params.limit - 每页数量
 * @param {string} params.targetNodeId - 目标节点 ID
 * @param {string} params.messageType - 消息类型
 * @returns {Promise<{total: number, list: Array}>}
 */
export function getMessageList(params) {
  return get('/messages', params)
}

/**
 * 获取消息详情
 * @param {number} id - 消息 ID
 * @returns {Promise<Object>}
 */
export function getMessageDetail(id) {
  return get(`/messages/${id}`)
}

/**
 * 发送控制消息
 * @param {Object} data - 消息数据
 * @param {string} data.targetNodeId - 目标节点 ID（可选，不填则广播）
 * @param {string} data.messageType - 消息类型
 * @param {Object} data.payload - 消息内容
 * @returns {Promise<Object>}
 */
export function sendMessage(data) {
  return post('/messages', data)
}

/**
 * 删除消息
 * @param {number} id - 消息 ID
 * @returns {Promise<void>}
 */
export function deleteMessage(id) {
  return del(`/messages/${id}`)
}

/**
 * 批量删除消息
 * @param {Array<number>} ids - 消息 ID 列表
 * @returns {Promise<{deleted: number}>}
 */
export function batchDeleteMessages(ids) {
  return post('/messages/batch-delete', { ids })
}

// ========== WebSocket 连接管理 ==========

/**
 * 获取在线连接列表
 * @returns {Promise<Array>}
 */
export function getOnlineConnections() {
  return get('/bridge/connections')
}

/**
 * 获取连接详情
 * @param {string} connectionId - 连接 ID
 * @returns {Promise<Object>}
 */
export function getConnectionDetail(connectionId) {
  return get(`/bridge/connections/${connectionId}`)
}

/**
 * 断开连接
 * @param {string} connectionId - 连接 ID
 * @returns {Promise<void>}
 */
export function disconnectConnection(connectionId) {
  return post(`/bridge/connections/${connectionId}/disconnect`)
}

/**
 * 向指定节点发送 Ping
 * @param {string} nodeId - 节点 ID
 * @returns {Promise<{latency: number}>}
 */
export function pingNode(nodeId) {
  return post(`/bridge/nodes/${nodeId}/ping`)
}

/**
 * 获取连接统计信息
 * @returns {Promise<{total: number, byNode: Object}>}
 */
export function getConnectionStats() {
  return get('/bridge/stats')
}

// ========== Runtime Event 日志 ==========

/**
 * 获取运行事件列表
 * @param {Object} params - 查询参数
 * @param {number} params.page - 页码
 * @param {number} params.limit - 每页数量
 * @param {string} params.eventType - 事件类型
 * @param {string} params.nodeId - 节点 ID
 * @param {string} params.startTime - 开始时间
 * @param {string} params.endTime - 结束时间
 * @returns {Promise<{total: number, list: Array}>}
 */
export function getEventList(params) {
  return get('/events', params)
}

/**
 * 获取事件详情
 * @param {number} id - 事件 ID
 * @returns {Promise<Object>}
 */
export function getEventDetail(id) {
  return get(`/events/${id}`)
}

/**
 * 清空事件日志
 * @param {string} beforeDate - 清空此日期之前的日志（可选）
 * @returns {Promise<{deleted: number}>}
 */
export function clearEvents(beforeDate) {
  return post('/events/clear', { beforeDate })
}

/**
 * 获取事件统计信息
 * @param {string} groupBy - 分组方式（type/node/date）
 * @returns {Promise<Object>}
 */
export function getEventStats(groupBy = 'type') {
  return get('/events/stats', { groupBy })
}
