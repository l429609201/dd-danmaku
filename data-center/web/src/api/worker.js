// Worker 管理走 Rust /api/admin；不要将缺失能力映射成语义不同的接口。
import { authFetch } from '../utils/api.js'

async function adminRequest(path, options = {}) {
  const response = await authFetch(`/api/admin${path}`, {
    ...options,
    body: options.body == null ? undefined : JSON.stringify(options.body)
  })
  const text = await response.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!response.ok) throw new Error(data?.message || data?.detail || (typeof data === 'string' && data) || `请求失败 (${response.status})`)
  return data
}

function queryString(params = {}) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, value)
  })
  return query.size ? `?${query}` : ''
}

// 未实现的管理功能保留导出并明确失败，禁止返回伪造成功结果。
const unavailable = (feature) => Promise.reject(new Error(`Rust 后端尚未提供${feature}接口`))
const resourceId = (id) => encodeURIComponent(String(id))

/** 获取节点：connected=true/false 分别筛选在线/离线；省略返回全部。裸数组，不分页。 */
export function getNodeList(params = {}) {
  return adminRequest(`/nodes${queryString(params)}`)
}
export function getNodeDetail(nodeId) {
  return adminRequest(`/nodes/${resourceId(nodeId)}`)
}
/** 创建或更新：{ node_id, worker_id, worker_url, connected }。 */
export function registerNode(data) {
  return adminRequest('/nodes', { method: 'POST', body: data })
}
export function deleteNode() { return unavailable('删除节点') }
export function updateNodeStatus() { return unavailable('单独更新节点状态') }
export function getNodeStats() { return unavailable('节点统计') }

/** {page,page_size,node_id,direction,message_type,status} → {items,total,page,page_size,total_pages}。 */
export function getMessageList(params = {}) {
  return adminRequest(`/messages${queryString(params)}`)
}
// 详情标识是 message_id 字符串，不是数据库自增 id。
export function getMessageDetail(messageId) {
  return adminRequest(`/messages/${resourceId(messageId)}`)
}
export function sendMessage() { return unavailable('发送控制消息') }
export function deleteMessage() { return unavailable('删除消息') }
export function batchDeleteMessages() { return unavailable('批量删除消息') }
export function getOnlineConnections() { return unavailable('实时连接列表') }
export function getConnectionDetail() { return unavailable('实时连接详情') }
export function disconnectConnection() { return unavailable('断开连接') }
export function pingNode() { return unavailable('节点 Ping') }
export function getConnectionStats() { return unavailable('实时连接统计') }
export function reconnectControl() { return unavailable('手动重连') }

/** {page,page_size,level,category,event} → {items,total,page,page_size,total_pages}。 */
export function getEventList(params = {}) {
  return adminRequest(`/events${queryString(params)}`)
}
export function getRecentErrors(params = {}) {
  return adminRequest(`/events/errors${queryString(params)}`)
}
export function getEventDetail() { return unavailable('运行事件详情') }
export function clearEvents() { return unavailable('清空运行事件') }
export function getEventStats() { return unavailable('运行事件分组统计') }
