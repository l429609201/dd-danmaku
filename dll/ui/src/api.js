const prefix = '/dd-danmaku/api'

function clientContext() {
  // 复用同源 Emby 管理页面会话；不把令牌放入 URL，也不另存凭据。
  let client = window.ApiClient
  if (!client) {
    try { client = window.parent?.ApiClient } catch { /* 跨源父页不可读取 */ }
  }
  const token = client?.accessToken?.()
  if (!token) throw new Error('未获取到 Emby 登录会话，请从已登录的 Emby 管理页面打开')
  const base = new URL(client.serverAddress(), window.location.href)
  if (base.origin !== window.location.origin) throw new Error('管理 API 必须与 Emby 会话同源')
  const userId = client?.getCurrentUserId?.()
  return { token, userId, base: base.href.replace(/\/$/, '') }
}

function currentUserId() {
  const { userId } = clientContext()
  if (!userId) throw new Error('未获取到当前 Emby 用户标识')
  return userId
}

async function request(path, options = {}, compatibility = false) {
  const { token, base } = clientContext()
  const response = await fetch(`${base}${compatibility ? '' : prefix}${path}`, {
    ...options,
    credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { 'Content-Type': 'application/json', ...options.headers, 'X-Emby-Token': token },
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.success === false || body?.Success === false) {
    const error = new Error(body?.message || body?.Message || `请求失败（${response.status}）`)
    error.status = response.status
    error.code = body?.errorCode || body?.ErrorCode || ''
    throw error
  }
  // 空响应、HTML 回退页或 JSON null 均不是成功，保留接口路径帮助定位部署/代理问题。
  if (body === null || typeof body !== 'object') {
    throw new Error(`接口 ${path} 返回空值或非 JSON 数据（HTTP ${response.status}），请检查 DLL 是否更新并重启 Emby，以及反向代理路由`)
  }
  // 兼容协议保留完整信封，单条 Data 与列表 DataList 由调用方分别处理。
  if (compatibility) return body
  const data = 'data' in body ? body.data : 'Data' in body ? body.Data : body
  // 使用发出本次请求的令牌反解；不写入浏览器存储，XOR 不替代 HTTPS。
  if (data?.secretEncoding === 'xor-utf8-base64-v1') {
    try {
      const bytes = Uint8Array.from(atob(data.payload), c => c.charCodeAt(0))
      const key = new TextEncoder().encode(token)
      for (let i = 0; i < bytes.length; i++) bytes[i] ^= key[i % key.length]
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch { throw new Error('敏感配置解码失败，请重新登录并读取；不要保存当前表单') }
  }
  return data
}

export const api = {
  // 管理员专用更新入口；新页面只检查，不调用自动安装任务。
  githubSettings: () => request('/config/github'),
  saveGithubSettings: data => request('/config/github', { method: 'PUT', body: JSON.stringify(data) }),
  checkUpdate: () => request('/updates/check'),
  // 跨用户操作仅使用管理员路由，不改变播放器本人接口的权限。
  parameterFiles: () => request('/parameter-files'),
  parameterFile: (id) => request(`/parameter-files/${encodeURIComponent(id)}`),
  saveParameterFile: (id, data) => request(`/parameter-files/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteParameterFile: (id) => request(`/parameter-files/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  copyParameterFile: (id, data) => request(`/parameter-files/${encodeURIComponent(id)}/copy`, { method: 'POST', body: JSON.stringify(data) }),
  // 转换只提交用户标识，完整敏感数据留在服务器内迁移。
  convertParameterFile: (id) => request(`/parameter-files/${encodeURIComponent(id)}/convert`, { method: 'POST' }),
  // 管理员扫描和 AI 接入独立接口，不经用户参数兼容层。
  // 与后端同步避开 Emby dashboard 网页兼容重写，不回退到旧路径。
  dashboard: () => request('/overview'),
  startScan: () => request('/library-scan/run', { method: 'POST' }),
  cancelScan: () => request('/library-scan/run', { method: 'DELETE' }),
  saveScanMode: (deep) => request('/library-scan/mode', { method: 'PUT', body: JSON.stringify({ deep }) }),
  // 扫描范围独立保存，供手动和原生计划任务共用。
  scanScope: () => request('/library-scan/scope'),
  saveScanScope: libraryIds => request('/library-scan/scope', { method: 'PUT', body: JSON.stringify({ libraryIds }) }),
  aiSettings: () => request('/config/ai'),
  // 草稿凭据仅通过请求正文发送，禁止放入 URL。
  aiModels: data => request('/config/ai/models', { method: 'POST', body: JSON.stringify(data) }),
  saveAiSettings: (data) => request('/config/ai', { method: 'PUT', body: JSON.stringify(data) }),
  capabilities: () => request('/capabilities'),
  // XML 策略独立保存，避免其他页面保存配置时覆盖联动开关。
  playbackSettings: () => request('/config/playback'),
  savePlaybackSettings: data => request('/config/playback', { method: 'PUT', body: JSON.stringify(data) }),
  config: () => request('/config'),
  users: () => request('/users'),
  saveConfig: (data) => request('/config', { method: 'PUT', body: JSON.stringify(data) }),
  parameters: (filters = {}) => {
    const query = new URLSearchParams(Object.entries({ Namespace: filters.namespace, Key: filters.key, Keyword: filters.keyword }).filter(([, value]) => value != null && value !== ''))
    return request(`/ParameterPersistence/Query${query.size ? `?${query}` : ''}`, {}, true)
  },
  saveParameter: (data) => request('/ParameterPersistence/Create', { method: 'POST', body: JSON.stringify({ userid: currentUserId(), ...data }) }, true),
  updateParameter: (data) => request('/ParameterPersistence/Update', { method: 'POST', body: JSON.stringify({ userid: currentUserId(), ...data }) }, true),
  deleteParameter: (data) => request('/ParameterPersistence/Delete', { method: 'POST', body: JSON.stringify({ userid: currentUserId(), ...data }) }, true),
  // 记录操作只提交索引标识，来源与路径由服务器解析。
  records: (page = 1, pageSize = 20, signal, filters = {}) => request(`/records?${new URLSearchParams({ page, pageSize, ...filters })}`, { signal }),
  recordDetail: (id, signal) => request(`/records/detail?recordId=${encodeURIComponent(id)}`, { signal }),
  verifyRecord: id => request(`/records/verify?recordId=${encodeURIComponent(id)}`, { method: 'POST' }),
  removeRecord: (id, deleteFile) => request(`/records/remove?recordId=${encodeURIComponent(id)}&deleteFile=${deleteFile}`, { method: 'DELETE' }),
  mediaLink: id => {
    const { base } = clientContext()
    // 保留反向代理前缀；不把会话令牌带入媒体详情地址。
    return `${base}/web/index.html#!/item?id=${encodeURIComponent(id)}`
  },
  downloadRecord: async id => {
    const { base, token } = clientContext()
    const response = await fetch(`${base}${prefix}/records/download?recordId=${encodeURIComponent(id)}`, {
      headers: { 'X-Emby-Token': token }, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    })
    if (!response.ok || !response.headers.get('content-type')?.includes('application/xml')) {
      const body = await response.json().catch(() => null)
      throw new Error(body?.message || `下载失败（${response.status}）`)
    }
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = url; link.download = 'danmaku.xml'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
  // 按记录来源读取对应 XML，保留原有 signal 参数位置。
  queryPlayback: (itemId, signal, source) => request(`/playback/${encodeURIComponent(itemId)}${source ? `?source=${encodeURIComponent(source)}` : ''}`, { signal }),
  // 新协议必须由调用方提供目标和候选，不再调用旧的按 ItemId 解释接口。
  resolveMatch: (data, signal) => request('/matches/resolve', { method: 'POST', body: JSON.stringify(data), signal }),
  frontendDefaults: (userId = '', signal) => request(`/config/frontend-defaults${userId ? `/users/${encodeURIComponent(userId)}` : ''}`, { signal }),
  saveFrontendDefaults: (userId, data) => request(`/config/frontend-defaults${userId ? `/users/${encodeURIComponent(userId)}` : ''}`, { method: 'PUT', body: JSON.stringify(data) }),
  resetFrontendDefaults: (userId) => request(`/config/frontend-defaults/users/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
}
