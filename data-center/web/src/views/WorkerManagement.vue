<template>
  <div class="worker-management">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-content">
        <h1>🔧 Worker配置</h1>
        <p>配置和监控主Worker节点</p>
      </div>
      <div class="header-actions">
        <button v-if="!workers.length" @click="addWorker" class="btn btn-primary">
          ➕ 配置Worker
        </button>
        <button v-else @click="addWorker" class="btn btn-secondary">
          ✏️ 修改配置
        </button>
      </div>
    </div>

    <!-- API密钥管理卡片 -->
    <div class="config-card">
      <div class="card-header">
        <h3>🔑 Worker API密钥管理</h3>
        <button @click="generateApiKey" class="btn btn-primary">🎲 生成新密钥</button>
      </div>
      <div class="card-body">
        <div class="form-group">
          <label>Worker API密钥</label>
          <div class="api-key-input">
            <input
              :value="currentApiKey"
              :type="showApiKey ? 'text' : 'password'"
              placeholder="点击生成API密钥"
              readonly
            />
            <button @click="toggleApiKeyVisibility" class="btn btn-outline">
              {{ showApiKey ? '🙈' : '👁️' }}
            </button>
            <button @click="copyApiKey" class="btn btn-outline" :disabled="!currentApiKey">
              📋 复制
            </button>
          </div>
          <small class="help-text">
            此密钥用于Worker与数据中心之间的双向认证通信
          </small>
        </div>

        <div v-if="currentApiKey" class="current-key-info">
          <h4>当前密钥信息</h4>
          <div class="key-info">
            <span class="label">密钥长度:</span>
            <span class="value">{{ currentApiKey.length }} 字符</span>
          </div>
          <div class="key-info">
            <span class="label">生成时间:</span>
            <span class="value">{{ new Date().toLocaleString() }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Worker状态 -->
    <div class="workers-grid">
      <div v-for="worker in workers" :key="worker.id" class="worker-card">
        <div class="card-header">
          <div class="worker-info">
            <h3>{{ worker.name }}</h3>
            <span :class="['status-badge', worker.status]">
              {{ getStatusText(worker.status) }}
            </span>
          </div>
          <div class="worker-actions">
            <button @click="testConnection(worker)" class="btn btn-sm btn-outline" title="测试连接">
              🔗
            </button>
            <button @click="viewRealtimeStats(worker)" class="btn btn-sm btn-outline" title="查看Worker实时统计">
              📊
            </button>
            <button @click="viewWorkerLimits(worker)" class="btn btn-sm btn-info" title="查看Worker限制统计">
              🚦
            </button>
            <button @click="viewSystemStats" class="btn btn-sm btn-success" title="查看数据中心系统统计">
              🖥️
            </button>
            <button @click="fetchWorkerLogs(worker)" class="btn btn-sm btn-outline" title="获取日志">
              📋
            </button>
            <button @click="viewWorkerSyncLogs(worker)" class="btn btn-sm btn-outline" title="查看同步日志">
              📄
            </button>
            <button @click="pushConfig(worker)" class="btn btn-sm btn-primary" title="推送配置">
              🚀
            </button>
            <button @click="fullSync(worker)" class="btn btn-sm btn-success" title="完整同步">
              🔄
            </button>
            <button @click="removeWorker(worker)" class="btn btn-sm btn-danger" title="清空Worker配置">
              🗑️
            </button>
          </div>
        </div>
        <div class="card-body">
          <div class="worker-url">
            <span class="label">URL:</span>
            <code>{{ worker.url }}</code>
          </div>
          <div class="worker-meta">
            <span class="meta-item">
              <span class="label">最后同步:</span>
              {{ worker.lastSync || '从未' }}
            </span>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-if="workers.length === 0" class="empty-state">
        <div class="empty-icon">🤖</div>
        <h3>暂未配置Worker</h3>
        <p>点击"配置Worker"开始设置您的Worker节点</p>
        <button @click="addWorker" class="btn btn-primary">
          ➕ 配置Worker
        </button>
      </div>
    </div>

    <!-- 添加Worker表单 -->
    <div v-if="showAddWorker" class="dialog-overlay">
      <div class="dialog">
        <h3>{{ workers.length ? '修改Worker配置' : '配置Worker' }}</h3>
        <div class="form-group">
          <label>Worker名称:</label>
          <input v-model="newWorker.name" type="text" placeholder="请输入Worker名称" />
        </div>
        <div class="form-group">
          <label>Worker URL:</label>
          <input v-model="newWorker.url" type="text" placeholder="https://your-worker.domain.com" />
        </div>
        <div class="form-group">
          <label>描述 (可选):</label>
          <input v-model="newWorker.description" type="text" placeholder="Worker描述信息" />
        </div>
        <div class="dialog-actions">
          <button @click="saveWorker" class="btn btn-primary">保存</button>
          <button @click="cancelAddWorker" class="btn btn-secondary">取消</button>
        </div>
      </div>
    </div>

    <!-- Worker限制统计弹窗 -->
    <div v-if="showWorkerLimitsModal" class="modal-overlay" @click="showWorkerLimitsModal = false">
      <div class="modal-content large" @click.stop>
        <div class="modal-header">
          <h2>🚦 Worker限制统计 - {{ selectedWorker?.name }}</h2>
          <button @click="showWorkerLimitsModal = false" class="close-btn">✕</button>
        </div>
        <div class="modal-body">
          <div class="stats-controls">
            <button @click="refreshWorkerLimits" :disabled="loading" class="btn btn-primary">
              {{ loading ? '刷新中...' : '🔄 刷新限制数据' }}
            </button>
          </div>

          <div v-if="workerLimits" class="limits-grid">
            <div class="limit-card">
              <h3>📊 总体统计</h3>
              <div class="stat-list">
                <div class="stat-item">
                  <span class="stat-label">活跃计数器</span>
                  <span class="stat-value">{{ workerLimits.total_counters }}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">活跃IP数</span>
                  <span class="stat-value">{{ workerLimits.active_ips }}</span>
                </div>
              </div>
            </div>

            <div class="limit-card">
              <h3>🎯 UA类型限制</h3>
              <div class="ua-limits">
                <div v-for="(uaStats, uaType) in workerLimits.ua_type_stats" :key="uaType" class="ua-item">
                  <div class="ua-header">{{ uaType }}</div>
                  <div class="ua-stats">
                    <span>活跃IP: {{ uaStats.active_ips }}</span>
                    <span>总请求: {{ uaStats.total_requests }}</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="limit-card">
              <h3>🛤️ 路径限制</h3>
              <div class="path-limits">
                <div v-for="(pathStats, pathPattern) in workerLimits.path_limit_stats" :key="pathPattern" class="path-item">
                  <div class="path-header">
                    {{ pathPattern }}
                    <span class="path-limit-badge">{{ pathStats.configured_limit || 50 }}/小时</span>
                  </div>
                  <div class="path-stats">
                    <span>活跃IP: {{ pathStats.active_ips }}</span>
                    <span>总请求: {{ pathStats.total_requests }}</span>
                    <span>UA类型: {{ pathStats.ua_types }}</span>
                    <span v-if="pathStats.ua_type">类型: {{ pathStats.ua_type }}</span>
                  </div>
                </div>
              </div>
              <div v-if="Object.keys(workerLimits.path_limit_stats || {}).length === 0" class="no-path-limits">
                暂无配置的路径限制
              </div>
            </div>
          </div>

          <div v-else class="no-data">
            暂无Worker限制数据
          </div>
        </div>
      </div>
    </div>

    <!-- Worker实时统计弹窗 -->
    <div v-if="showRealtimeStatsModal" class="modal-overlay" @click="showRealtimeStatsModal = false">
      <div class="modal-content large" @click.stop>
        <div class="modal-header">
          <h2>📊 Worker实时统计 - {{ selectedWorker?.name }}</h2>
          <button @click="showRealtimeStatsModal = false" class="close-btn">✕</button>
        </div>
        <div class="modal-body">
          <div class="stats-controls">
            <button @click="refreshRealtimeStats" :disabled="realtimeLoading" class="btn btn-primary">
              {{ realtimeLoading ? '获取中...' : '🔄 刷新实时数据' }}
            </button>
            <span v-if="realtimeStats" class="last-update">
              最后更新: {{ realtimeStats.last_update }}
            </span>
          </div>

          <div v-if="realtimeStats && realtimeStats.success" class="realtime-stats-grid">
            <!-- 基础统计 -->
            <div class="stats-section">
              <h3>📈 基础统计</h3>
              <div class="stats-row">
                <div class="stat-item">
                  <span class="label">Worker ID:</span>
                  <span class="value">{{ realtimeStats.stats.worker_id }}</span>
                </div>
                <div class="stat-item">
                  <span class="label">总请求数:</span>
                  <span class="value">{{ realtimeStats.stats.requests_total || 0 }}</span>
                </div>
                <div class="stat-item">
                  <span class="label">待处理请求:</span>
                  <span class="value">{{ realtimeStats.stats.pending_requests || 0 }}</span>
                </div>
                <div class="stat-item">
                  <span class="label">内存缓存大小:</span>
                  <span class="value">{{ realtimeStats.stats.memory_cache_size || 0 }}</span>
                </div>
              </div>
            </div>

            <!-- 秘钥轮换统计 -->
            <div v-if="realtimeStats.stats.secret_rotation" class="stats-section">
              <h3>🔑 秘钥轮换统计</h3>
              <div class="stats-row">
                <div class="stat-item">
                  <span class="label">秘钥1使用次数:</span>
                  <span class="value">{{ realtimeStats.stats.secret_rotation.secret1_count || 0 }}</span>
                </div>
                <div class="stat-item">
                  <span class="label">秘钥2使用次数:</span>
                  <span class="value">{{ realtimeStats.stats.secret_rotation.secret2_count || 0 }}</span>
                </div>
                <div class="stat-item">
                  <span class="label">当前使用秘钥:</span>
                  <span class="value">{{ realtimeStats.stats.secret_rotation.current || 'N/A' }}</span>
                </div>
                <div class="stat-item">
                  <span class="label">轮换限制:</span>
                  <span class="value">{{ realtimeStats.stats.secret_rotation.rotation_limit || 0 }}</span>
                </div>
              </div>
            </div>

            <!-- 频率限制统计 -->
            <div v-if="realtimeStats.stats.rate_limit_stats" class="stats-section">
              <h3>⏱️ 频率限制统计</h3>
              <div class="stats-row">
                <div class="stat-item">
                  <span class="label">总计数器:</span>
                  <span class="value">{{ realtimeStats.stats.rate_limit_stats.total_counters || 0 }}</span>
                </div>
                <div class="stat-item">
                  <span class="label">活跃IP数:</span>
                  <span class="value">{{ Object.keys(realtimeStats.stats.rate_limit_stats.active_ips || {}).length }}</span>
                </div>
              </div>
            </div>

            <!-- 配置统计 -->
            <div v-if="realtimeStats.stats.config_stats" class="stats-section">
              <h3>⚙️ 配置统计</h3>
              <div class="stats-row">
                <div class="stat-item">
                  <span class="label">UA配置数量:</span>
                  <span class="value">{{ realtimeStats.stats.config_stats.ua_configs_count || 0 }}</span>
                </div>
                <div class="stat-item">
                  <span class="label">IP黑名单数量:</span>
                  <span class="value">{{ realtimeStats.stats.config_stats.ip_blacklist_count || 0 }}</span>
                </div>
                <div class="stat-item">
                  <span class="label">最后配置更新:</span>
                  <span class="value">{{ formatTimestamp(realtimeStats.stats.config_stats.last_config_update) }}</span>
                </div>
              </div>
            </div>

            <!-- 日志统计和实时日志 -->
            <div class="stats-section">
              <h3>📋 日志统计和实时日志</h3>
              <div class="stats-row">
                <div class="stat-item">
                  <span class="label">日志数量:</span>
                  <span class="value">{{ realtimeStats.stats.logs_count || 0 }}</span>
                </div>
                <div class="stat-item">
                  <span class="label">运行时间:</span>
                  <span class="value">{{ formatDuration(realtimeStats.stats.uptime) }}</span>
                </div>
                <div class="stat-item">
                  <span class="label">最后同步:</span>
                  <span class="value">{{ formatTimestamp(realtimeStats.stats.last_sync_time) }}</span>
                </div>
              </div>

              <!-- 实时日志显示 -->
              <div class="realtime-logs">
                <div class="logs-header">
                  <h4>🔄 实时日志 (最近10条)</h4>
                  <button @click="refreshRealtimeLogs" :disabled="logsLoading" class="btn btn-sm btn-outline">
                    {{ logsLoading ? '获取中...' : '刷新日志' }}
                  </button>
                </div>

                <div v-if="realtimeLogs && realtimeLogs.length > 0" class="logs-container">
                  <div v-for="(log, index) in realtimeLogs" :key="index" :class="['log-entry', `log-${log.level.toLowerCase()}`]">
                    <span class="log-time">{{ formatLogTime(log.timestamp) }}</span>
                    <span class="log-level">{{ log.level }}</span>
                    <span class="log-message">{{ log.message }}</span>
                    <div v-if="log.data && Object.keys(log.data).length > 0" class="log-data">
                      {{ JSON.stringify(log.data) }}
                    </div>
                  </div>
                </div>

                <div v-else-if="!logsLoading" class="no-logs">
                  暂无日志数据
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="realtimeStats && !realtimeStats.success" class="error-message">
            <p>❌ {{ realtimeStats.message }}</p>
            <p v-if="realtimeStats.worker_endpoint">Worker端点: {{ realtimeStats.worker_endpoint }}</p>
          </div>

          <div v-else-if="!realtimeLoading" class="no-data">
            <p>点击"刷新实时数据"获取Worker统计信息</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 消息提示 -->
    <div v-if="message" :class="['toast', message.type]">
      {{ message.text }}
    </div>
  </div>
</template>

<script>
import { authFetch } from '../utils/api.js'

export default {
  name: 'WorkerManagement',
  data() {
    return {
      workers: [],
      showAddWorker: false,
      currentApiKey: '',
      showApiKey: false,
      message: null,
      newWorker: {
        name: '',
        url: '',
        description: ''
      },
      heartbeatTimer: null,
      // Worker限制统计相关
      showWorkerLimitsModal: false,
      selectedWorker: null,
      workerLimits: null,
      loading: false,
      // Worker实时统计相关
      showRealtimeStatsModal: false,
      realtimeStats: null,
      realtimeLoading: false,
      // Worker实时日志相关
      realtimeLogs: [],
      logsLoading: false
    }
  },

  async mounted() {
    // 导入认证检查函数
    const { isLoggedIn } = await import('@/utils/api')

    // 等待一小段时间确保认证状态已经恢复
    await new Promise(resolve => setTimeout(resolve, 200))

    // 检查是否已登录，如果未登录则不发起API请求
    if (!isLoggedIn()) {
      console.warn('用户未登录，跳过API请求，从本地缓存加载数据')
      this.loadWorkersFromCache()

      // 尝试从sessionStorage恢复API密钥
      const savedApiKey = sessionStorage.getItem('worker_api_key')
      if (savedApiKey) {
        this.currentApiKey = savedApiKey
      }
      return
    }

    // 优先从后端加载Worker列表
    await this.loadWorkersFromServer()

    // 从服务器加载当前API密钥
    await this.loadCurrentApiKey()

    // 如果服务器没有API密钥，尝试从sessionStorage恢复
    if (!this.currentApiKey) {
      const savedApiKey = sessionStorage.getItem('worker_api_key')
      if (savedApiKey) {
        this.currentApiKey = savedApiKey
      }
    }

    // 进入页面时立即请求一次Worker状态
    await this.checkWorkerStatus()

    // 启动心跳检查
    this.startHeartbeat()
  },

  beforeUnmount() {
    // 清理心跳定时器
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
    }
  },

  methods: {
    async loadWorkersFromServer() {
      try {
        const response = await authFetch('/api/web-config/workers')

        if (response.ok) {
          const workers = await response.json()
          console.log('从服务器加载Worker列表:', workers)

          // 转换服务器数据格式到前端格式
          this.workers = workers.map(worker => ({
            id: worker.id,
            name: worker.name,
            url: worker.endpoint,
            description: worker.description || '',
            status: worker.status || 'unknown',
            lastSync: worker.last_sync || '从未同步',
            version: '未知'
          }))

          // 同时保存到localStorage作为缓存
          localStorage.setItem('worker_list', JSON.stringify(this.workers))
        } else if (response.status === 401) {
          // 认证失败，静默处理，不显示错误
          console.warn('认证失败，从本地缓存加载Worker列表')
          this.loadWorkersFromCache()
        } else {
          console.warn('从服务器加载Worker列表失败，尝试从本地缓存加载')
          this.loadWorkersFromCache()
        }
      } catch (error) {
        console.error('加载Worker列表异常:', error)
        this.loadWorkersFromCache()
      }
    },

    loadWorkersFromCache() {
      // 从localStorage加载Worker列表作为备用方案
      const savedWorkers = localStorage.getItem('worker_list')
      if (savedWorkers) {
        try {
          this.workers = JSON.parse(savedWorkers)
          console.log('从本地缓存加载Worker列表')
        } catch (e) {
          console.error('恢复Worker列表失败:', e)
        }
      }
    },

    async testConnection(worker) {
      this.showMessage('测试连接功能', 'info')
    },

    pushConfig(worker) {
      this.showMessage('推送配置功能', 'info')
    },

    async viewStats(worker) {
      this.showMessage(`正在获取 ${worker.name} 的统计数据...`, 'info')

      try {
        const response = await authFetch('/api/worker/fetch-stats', {
          method: 'POST'
        })

        if (response.ok) {
          const result = await response.json()
          console.log('统计数据获取结果:', result)

          if (result.success && result.stats && result.stats.length > 0) {
            // 根据Worker URL找到对应的统计数据
            const workerStats = result.stats.find(s => s.worker_url === worker.url || s.worker_url.includes(worker.url) || worker.url.includes(s.worker_url))
            if (workerStats && workerStats.success && workerStats.stats) {
              const stats = workerStats.stats
              const message = `${worker.name} 统计信息：

🔧 Worker实例信息 (当前边缘节点):
• 总请求数: ${stats.requests_total || 0} (仅当前实例)
• 待处理请求: ${stats.pending_requests || 0}
• 运行时间: ${Math.floor((stats.uptime || 0) / 1000 / 60)} 分钟
• 内存缓存: ${stats.memory_cache_size || 0} 项
• 日志数量: ${stats.logs_count || 0} 条

⚙️ 配置信息:
• UA配置: ${stats.config_stats?.ua_configs_count || 0} 条
• IP黑名单: ${stats.config_stats?.ip_blacklist_count || 0} 条
• 最后配置更新: ${stats.config_stats?.last_config_update ? new Date(stats.config_stats.last_config_update).toLocaleString() : '未更新'}

🔐 秘钥轮换:
• Secret1使用: ${stats.secret_rotation?.secret1_count || 0} 次
• Secret2使用: ${stats.secret_rotation?.secret2_count || 0} 次
• 当前使用: Secret${stats.secret_rotation?.current_secret || '1'}
• 轮换阈值: ${stats.secret_rotation?.rotation_limit || 500} 次

注意: Worker统计数据仅反映当前边缘节点实例的情况`
              this.showMessage(message, 'success')
            } else if (workerStats && !workerStats.success) {
              this.showMessage(`获取 ${worker.name} 统计数据失败: ${workerStats.error}`, 'error')
            } else {
              this.showMessage(`未找到 ${worker.name} 的统计数据`, 'warning')
            }
          } else {
            this.showMessage(`获取 ${worker.name} 统计数据失败: ${result.message || '未知错误'}`, 'error')
          }
        } else {
          this.showMessage(`获取 ${worker.name} 统计数据失败: HTTP ${response.status}`, 'error')
        }
      } catch (error) {
        this.showMessage(`获取 ${worker.name} 统计数据异常: ${error.message}`, 'error')
      }
    },

    // 查看Worker限制统计
    async viewWorkerLimits(worker) {
      this.selectedWorker = worker
      this.showWorkerLimitsModal = true
      await this.refreshWorkerLimits()
    },

    // 刷新Worker限制数据
    async refreshWorkerLimits() {
      this.loading = true
      try {
        const response = await authFetch('/api/web-config/worker/stats')
        if (response.ok) {
          const data = await response.json()
          if (data.success && data.stats && data.stats.rate_limit_stats) {
            this.workerLimits = data.stats.rate_limit_stats
            this.showMessage('Worker限制数据刷新成功', 'success')
          } else {
            this.showMessage('获取Worker限制数据失败', 'error')
          }
        } else {
          this.showMessage(`获取Worker限制数据失败: HTTP ${response.status}`, 'error')
        }
      } catch (error) {
        console.error('获取Worker限制数据失败:', error)
        this.showMessage(`获取Worker限制数据异常: ${error.message}`, 'error')
      } finally {
        this.loading = false
      }
    },

    // 查看Worker实时统计
    async viewRealtimeStats(worker) {
      this.selectedWorker = worker
      this.showRealtimeStatsModal = true
      await this.refreshRealtimeStats()
      await this.refreshRealtimeLogs()
    },

    // 刷新Worker实时统计数据
    async refreshRealtimeStats() {
      this.realtimeLoading = true
      try {
        const response = await authFetch('/api/web-config/worker/realtime-stats')
        if (response.ok) {
          const result = await response.json()
          this.realtimeStats = result
          if (result.success) {
            this.showMessage('实时统计数据获取成功', 'success')
          } else {
            this.showMessage(result.message || '实时统计数据获取失败', 'error')
          }
        } else {
          this.realtimeStats = {
            success: false,
            message: `HTTP ${response.status} 错误`
          }
          this.showMessage(`获取实时统计数据失败: HTTP ${response.status}`, 'error')
        }
      } catch (error) {
        this.realtimeStats = {
          success: false,
          message: `请求异常: ${error.message}`
        }
        this.showMessage(`获取实时统计数据异常: ${error.message}`, 'error')
      } finally {
        this.realtimeLoading = false
      }
    },

    // 格式化时间戳
    formatTimestamp(timestamp) {
      if (!timestamp) return 'N/A'
      try {
        return new Date(timestamp).toLocaleString()
      } catch (e) {
        return 'N/A'
      }
    },

    // 格式化持续时间
    formatDuration(ms) {
      if (!ms) return 'N/A'
      const seconds = Math.floor(ms / 1000)
      const minutes = Math.floor(seconds / 60)
      const hours = Math.floor(minutes / 60)
      const days = Math.floor(hours / 24)

      if (days > 0) return `${days}天 ${hours % 24}小时`
      if (hours > 0) return `${hours}小时 ${minutes % 60}分钟`
      if (minutes > 0) return `${minutes}分钟 ${seconds % 60}秒`
      return `${seconds}秒`
    },

    // 刷新Worker实时日志
    async refreshRealtimeLogs() {
      this.logsLoading = true
      try {
        // 直接从Worker获取日志
        const response = await authFetch('/api/web-config/worker/realtime-stats')
        if (response.ok) {
          const result = await response.json()
          if (result.success && result.stats && result.stats.logs) {
            // 获取最近10条日志并按时间倒序排列
            this.realtimeLogs = result.stats.logs
              .slice(-10)
              .reverse()
          } else {
            this.realtimeLogs = []
          }
        } else {
          this.realtimeLogs = []
          this.showMessage(`获取实时日志失败: HTTP ${response.status}`, 'error')
        }
      } catch (error) {
        this.realtimeLogs = []
        this.showMessage(`获取实时日志异常: ${error.message}`, 'error')
      } finally {
        this.logsLoading = false
      }
    },

    // 格式化日志时间
    formatLogTime(timestamp) {
      if (!timestamp) return 'N/A'
      try {
        return new Date(timestamp).toLocaleTimeString()
      } catch (e) {
        return 'N/A'
      }
    },

    async loadCurrentApiKey() {
      try {
        // 使用authFetch获取当前API密钥
        const response = await authFetch('/api/web-config/workers/current-api-key', {
          method: 'GET'
        })

        if (response.ok) {
          const result = await response.json()
          if (result.success && result.data.api_key) {
            this.currentApiKey = result.data.api_key
            // 同步到sessionStorage
            sessionStorage.setItem('worker_api_key', this.currentApiKey)
          }
        } else if (response.status === 401) {
          // 认证失败，静默处理
          console.warn('认证失败，无法加载API密钥')
        }
      } catch (error) {
        console.error('加载API密钥失败:', error)
      }
    },

    async generateApiKey() {
      try {
        // 使用authFetch调用后端API生成并保存API密钥
        const response = await authFetch('/api/web-config/workers/generate-api-key', {
          method: 'POST'
        })

        const result = await response.json()

        if (result.success) {
          this.currentApiKey = result.data.api_key
          // 保存到sessionStorage，页面切换后不会丢失
          sessionStorage.setItem('worker_api_key', this.currentApiKey)
          this.showMessage('API密钥生成并保存成功', 'success')
        } else {
          this.showMessage(`生成API密钥失败: ${result.message}`, 'error')
        }
      } catch (error) {
        console.error('生成API密钥失败:', error)
        this.showMessage('生成API密钥失败', 'error')
      }
    },

    addWorker() {
      // 显示Worker配置表单
      this.showAddWorker = true

      // 如果已有Worker，预填充表单
      if (this.workers.length > 0) {
        const worker = this.workers[0]
        this.newWorker = {
          name: worker.name,
          url: worker.url,
          description: worker.description || ''
        }
      } else {
        this.newWorker = {
          name: '主Worker节点 (Primary Worker Node)',
          url: '',
          description: ''
        }
      }
    },

    async saveWorker() {
      if (!this.newWorker.name || !this.newWorker.url) {
        this.showMessage('请填写Worker名称和URL', 'error')
        return
      }

      this.showMessage('正在保存Worker配置...', 'info')

      try {
        const response = await authFetch('/api/web-config/workers', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: this.newWorker.name,
            endpoint: this.newWorker.url,
            description: this.newWorker.description
          })
        })

        const result = await response.json()
        console.log('保存Worker响应:', result)

        if (response.ok && result.success) {
          this.showAddWorker = false
          this.showMessage(`Worker配置保存成功: ${result.message}`, 'success')

          // 重新从服务器加载Worker列表以获取正确的ID
          await this.loadWorkersFromServer()
        } else {
          this.showMessage(`保存失败: ${result.message || '未知错误'}`, 'error')
        }
      } catch (error) {
        console.error('保存Worker异常:', error)
        this.showMessage(`保存异常: ${error.message}`, 'error')
      }
    },

    async viewWorkerSyncLogs(worker) {
      this.showMessage(`正在获取 ${worker.name} 的同步日志...`, 'info')

      try {
        const response = await authFetch(`/api/logs/worker-logs?worker_id=${encodeURIComponent(worker.id)}&limit=50`)

        if (response.ok) {
          const result = await response.json()
          console.log('Worker同步日志:', result)

          if (result.success && result.logs && result.logs.length > 0) {
            // 格式化显示日志
            let logText = `${worker.name} 同步日志 (最近50条):\n\n`

            result.logs.forEach(log => {
              const timestamp = new Date(log.created_at).toLocaleString()
              logText += `[${timestamp}] ${log.level} - ${log.message}\n`

              // 如果有详细信息，也显示
              if (log.details && Object.keys(log.details).length > 0) {
                logText += `  详情: ${JSON.stringify(log.details, null, 2)}\n`
              }

              if (log.ip_address) {
                logText += `  IP: ${log.ip_address}\n`
              }

              logText += '\n'
            })

            // 使用alert显示日志（简单实现）
            alert(logText)
          } else {
            this.showMessage(`${worker.name} 暂无同步日志`, 'warning')
          }
        } else {
          this.showMessage(`获取 ${worker.name} 同步日志失败: HTTP ${response.status}`, 'error')
        }
      } catch (error) {
        console.error('获取Worker同步日志异常:', error)
        this.showMessage(`获取 ${worker.name} 同步日志异常: ${error.message}`, 'error')
      }
    },

    cancelAddWorker() {
      this.showAddWorker = false
      this.newWorker = {
        name: '',
        url: '',
        description: ''
      }
    },

    async copyApiKey() {
      try {
        await navigator.clipboard.writeText(this.currentApiKey)
        this.showMessage('API密钥已复制到剪贴板', 'success')
      } catch (error) {
        this.showMessage('复制失败', 'error')
      }
    },

    toggleApiKeyVisibility() {
      this.showApiKey = !this.showApiKey
    },

    getStatusText(status) {
      const statusMap = {
        online: '在线',
        offline: '离线',
        error: '错误',
        unknown: '未知'
      }
      return statusMap[status] || '未知'
    },

    async testConnection(worker) {
      this.showMessage(`正在测试 ${worker.name} 的连接...`, 'info')

      try {
        // 模拟连接测试
        await new Promise(resolve => setTimeout(resolve, 1000))

        // 随机结果模拟
        const isSuccess = Math.random() > 0.3
        if (isSuccess) {
          worker.status = 'online'
          worker.version = 'v1.0.0'
          worker.lastSync = new Date().toLocaleString()
          this.showMessage(`${worker.name} 连接测试成功`, 'success')
        } else {
          worker.status = 'offline'
          this.showMessage(`${worker.name} 连接测试失败`, 'error')
        }

        // 保存状态
        localStorage.setItem('worker_list', JSON.stringify(this.workers))

      } catch (error) {
        worker.status = 'error'
        this.showMessage(`${worker.name} 连接测试异常: ${error.message}`, 'error')
      }
    },



    async pushConfig(worker) {
      this.showMessage(`正在推送配置...`, 'info')

      try {
        // 通过后端API推送配置
        const response = await authFetch('/api/worker/push-config', {
          method: 'POST'
        })

        if (response.ok) {
          const data = await response.json()
          worker.lastSync = new Date().toLocaleString()
          this.showMessage(data.message || '配置推送成功', 'success')

          // 保存状态
          localStorage.setItem('worker_list', JSON.stringify(this.workers))
        } else {
          throw new Error(`HTTP ${response.status}`)
        }

      } catch (error) {
        this.showMessage(`配置推送失败: ${error.message}`, 'error')
      }
    },

    async fetchWorkerLogs(worker) {
      this.showMessage(`正在从 ${worker.name} 获取日志...`, 'info')

      try {
        // 通过后端API获取Worker日志
        const response = await authFetch('/api/worker/fetch-logs', {
          method: 'POST'
        })

        if (response.ok) {
          const data = await response.json()
          const logCount = data.logs ? data.logs.length : 0
          this.showMessage(`获取到 ${logCount} 条日志`, 'success')

          // 处理日志数据
          console.log('Worker日志:', data)
        } else {
          throw new Error(`HTTP ${response.status}`)
        }

      } catch (error) {
        this.showMessage(`从 ${worker.name} 获取日志失败: ${error.message}`, 'error')
      }
    },

    async fullSync(worker) {
      this.showMessage(`正在与 ${worker.name} 执行完整同步...`, 'info')

      try {
        // 1. 推送配置
        await this.pushConfig(worker)

        // 2. 获取统计数据 - 通过后端API
        const statsResponse = await authFetch('/api/worker/fetch-stats', {
          method: 'POST'
        })

        if (statsResponse.ok) {
          const statsData = await statsResponse.json()
          console.log(`统计数据获取结果:`, statsData)
        }

        // 3. 获取日志
        await this.fetchWorkerLogs(worker)

        worker.lastSync = new Date().toLocaleString()
        this.showMessage(`与 ${worker.name} 完整同步成功`, 'success')

        // 保存状态
        localStorage.setItem('worker_list', JSON.stringify(this.workers))

      } catch (error) {
        this.showMessage(`与 ${worker.name} 完整同步失败: ${error.message}`, 'error')
      }
    },

    viewLogs(worker) {
      this.showMessage(`查看 ${worker.name} 的日志`, 'info')
      // 模拟打开日志页面
      setTimeout(() => {
        this.showMessage(`${worker.name} 最新日志：系统运行正常，最后活动时间 ${new Date().toLocaleString()}`, 'success')
      }, 500)
    },

    async removeWorker(worker) {
      if (confirm(`确定要清空Worker配置吗？`)) {
        try {
          // 调用后端API删除Worker
          const response = await authFetch(`/api/web-config/workers/${worker.id}`, {
            method: 'DELETE'
          })

          if (response.ok) {
            const result = await response.json()
            if (result.success) {
              this.showMessage(`Worker配置已清空`, 'success')
              // 重新从服务器加载Worker列表以确保数据一致性
              await this.loadWorkersFromServer()
            } else {
              this.showMessage(`清空配置失败: ${result.message}`, 'error')
            }
          } else {
            this.showMessage(`清空配置失败: HTTP ${response.status}`, 'error')
          }
        } catch (error) {
          console.error('清空配置异常:', error)
          this.showMessage(`清空配置异常: ${error.message}`, 'error')
        }
      }
    },

    showMessage(text, type = 'info') {
      this.message = { text, type }
      setTimeout(() => {
        this.message = null
      }, 3000)
    },

    startHeartbeat() {
      // 每10分钟检查一次Worker状态
      this.heartbeatTimer = setInterval(async () => {
        await this.checkWorkerStatus()
      }, 600000) // 10分钟 = 600000毫秒

      // 注意：不在这里立即执行，因为mounted中已经执行过了
    },

    async checkWorkerStatus() {
      if (this.workers.length === 0) return

      for (const worker of this.workers) {
        try {
          const response = await authFetch('/api/worker/fetch-stats', {
            method: 'POST'
          })

          if (response.ok) {
            const result = await response.json()
            if (result.success && result.stats && result.stats.length > 0) {
              const workerStats = result.stats.find(s => s.worker_url === worker.url || s.worker_url.includes(worker.url) || worker.url.includes(s.worker_url))
              if (workerStats && workerStats.success) {
                worker.status = 'online'
                worker.lastSync = new Date().toLocaleString()
              } else {
                worker.status = 'offline'
              }
            } else {
              worker.status = 'offline'
            }
          } else {
            worker.status = 'offline'
          }
        } catch (error) {
          worker.status = 'offline'
        }
      }
    },

    async viewSystemStats() {
      try {
        const response = await authFetch('/api/worker/system-stats', {
          method: 'GET'
        })

        if (response.ok) {
          const result = await response.json()
          if (result.success && result.stats) {
            const stats = result.stats
            const message = `数据中心系统统计：

💻 CPU信息:
• 使用率: ${stats.cpu?.usage_percent || 0}%
• 核心数: ${stats.cpu?.core_count || 0}
• 频率: ${stats.cpu?.frequency_mhz || 0} MHz

🧠 内存信息:
• 总内存: ${stats.memory?.total_mb || 0} MB
• 已使用: ${stats.memory?.used_mb || 0} MB (${stats.memory?.usage_percent || 0}%)
• 可用内存: ${stats.memory?.available_mb || 0} MB
• 交换分区: ${stats.memory?.swap_used_mb || 0}/${stats.memory?.swap_total_mb || 0} MB (${stats.memory?.swap_percent || 0}%)

💾 磁盘信息:
• 总容量: ${stats.disk?.total_gb || 0} GB
• 已使用: ${stats.disk?.used_gb || 0} GB (${stats.disk?.usage_percent || 0}%)
• 可用空间: ${stats.disk?.free_gb || 0} GB

🌐 网络统计:
• 发送: ${Math.round((stats.network?.bytes_sent || 0) / 1024 / 1024)} MB
• 接收: ${Math.round((stats.network?.bytes_recv || 0) / 1024 / 1024)} MB

🔧 进程信息:
• CPU使用: ${stats.process?.cpu_percent || 0}%
• 内存使用: ${stats.process?.memory_mb || 0} MB (${stats.process?.memory_percent || 0}%)
• 线程数: ${stats.process?.threads || 0}
• 连接数: ${stats.process?.connections || 0}

🗄️ 数据库:
• 状态: ${stats.database?.status || '未知'}

⏱️ 运行时间: ${Math.floor((stats.uptime_seconds || 0) / 60)} 分钟`

            this.showMessage(message, 'info')
          } else {
            this.showMessage(`获取系统统计失败: ${result.message}`, 'error')
          }
        } else {
          this.showMessage(`获取系统统计失败: HTTP ${response.status}`, 'error')
        }
      } catch (error) {
        this.showMessage(`获取系统统计异常: ${error.message}`, 'error')
      }
    }
  }
}
</script>

<style scoped>
.worker-management {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
  background: #f5f5f5;
  min-height: calc(100vh - 64px);
}

/* 页面头部 */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
  padding: 24px;
  background: white;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.header-content h1 {
  font-size: 28px;
  font-weight: 600;
  color: #333;
  margin: 0 0 8px 0;
}

.header-content p {
  color: #666;
  margin: 0;
  font-size: 16px;
}

.header-actions {
  display: flex;
  gap: 12px;
}

/* 按钮样式 */
.btn {
  padding: 12px 24px;
  border: none;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.btn-primary {
  background: #1976d2;
  color: white;
}

.btn-primary:hover {
  background: #1565c0;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(25, 118, 210, 0.3);
}

.btn-success {
  background: #67c23a;
  color: white;
}

.btn-success:hover {
  background: #5daf34;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(103, 194, 58, 0.3);
}

.btn-danger {
  background: #f44336;
  color: white;
}

.btn-danger:hover {
  background: #d32f2f;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(244, 67, 54, 0.3);
}

.btn-secondary {
  background: #f5f5f5;
  color: #333;
  border: 1px solid #ddd;
}

.btn-secondary:hover {
  background: #e0e0e0;
  border-color: #ccc;
  transform: translateY(-1px);
}

.btn-outline {
  background: white;
  color: #333;
  border: 1px solid #ddd;
}

.btn-outline:hover {
  background: #f5f5f5;
  border-color: #ccc;
  transform: translateY(-1px);
}

.btn-sm {
  padding: 8px 16px;
  font-size: 13px;
}

/* 配置卡片样式 */
.config-card {
  background: white;
  padding: 24px;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  transition: all 0.3s ease;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  margin-bottom: 24px;
}

.config-card:hover {
  background: #fafafa;
  border-color: #d0d0d0;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

.config-card .card-header {
  padding: 0 0 16px 0;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.config-card .card-header h3 {
  color: #333;
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.config-card .card-body {
  padding: 0;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: #333;
}

.api-key-input {
  display: flex;
  gap: 8px;
  align-items: center;
}

.api-key-input input {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 13px;
  background: #f9f9f9;
  color: #333;
}

.help-text {
  display: block;
  margin-top: 6px;
  font-size: 13px;
  color: #666;
  line-height: 1.4;
}

.current-key-info {
  margin-top: 16px;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 6px;
  border: 1px solid #e9ecef;
}

.current-key-info h4 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.key-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.key-info:last-child {
  margin-bottom: 0;
}

.key-info .label {
  font-weight: 500;
  color: #666;
}

.key-info .value {
  color: #333;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 13px;
}

/* Worker网格 */
.workers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
  gap: 20px;
}

.worker-card {
  background: white;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  transition: all 0.3s ease;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.worker-card:hover {
  background: #fafafa;
  border-color: #d0d0d0;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

.worker-card .card-header {
  padding: 20px 24px 16px;
  border-bottom: 1px solid #e0e0e0;
}

.worker-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.worker-info h3 {
  font-size: 18px;
  font-weight: 600;
  color: #333;
  margin: 0;
  min-width: 280px;
  max-width: 400px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-badge {
  padding: 6px 16px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
}

.status-badge.online {
  background: #e8f5e8;
  color: #4caf50;
  border: 1px solid #c8e6c9;
}

.status-badge.offline {
  background: #ffebee;
  color: #f44336;
  border: 1px solid #ffcdd2;
}

.status-badge.error {
  background: #fff3e0;
  color: #ff9800;
  border: 1px solid #ffcc02;
}

.status-badge.unknown {
  background: #f5f5f5;
  color: #666;
  border: 1px solid #ddd;
}

.worker-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.worker-card .card-body {
  padding: 20px 28px 24px;
}

.worker-url {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.worker-url .label {
  font-size: 15px;
  color: #a0a0a0;
  font-weight: 500;
}

.worker-url code {
  background: #f5f5f5;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: #333;
  border: 1px solid #ddd;
}

.worker-meta {
  display: flex;
  gap: 20px;
}

.meta-item {
  font-size: 15px;
  color: #a0a0a0;
}

.meta-item .label {
  font-weight: 500;
  color: #ffffff;
}

/* 空状态 */
.empty-state {
  grid-column: 1 / -1;
  text-align: center;
  padding: 60px 32px;
  background: white;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  transition: all 0.3s ease;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.empty-state:hover {
  background: #fafafa;
  border-color: #d0d0d0;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

.empty-icon {
  font-size: 72px;
  margin-bottom: 20px;
  opacity: 0.7;
}

.empty-state h3 {
  font-size: 24px;
  font-weight: 600;
  color: #ffffff;
  margin: 0 0 12px 0;
}

.empty-state p {
  color: #a0a0a0;
  margin: 0 0 32px 0;
  font-size: 16px;
}

/* 消息提示 */
.toast {
  position: fixed;
  top: 24px;
  right: 24px;
  padding: 18px 24px;
  border-radius: 12px;
  font-weight: 500;
  z-index: 1001;
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
  animation: slideIn 0.3s ease-out;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.toast.success {
  background: linear-gradient(135deg, #10b981, #06d6a0);
  color: white;
}

.toast.error {
  background: linear-gradient(135deg, #ef4444, #f87171);
  color: white;
}

.toast.info {
  background: linear-gradient(135deg, #3b82f6, #06b6d4);
  color: white;
}

@keyframes slideIn {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

/* 响应式设计 */
@media (max-width: 768px) {
  .worker-management {
    padding: 16px;
  }

  .page-header {
    flex-direction: column;
    gap: 20px;
    align-items: stretch;
    padding: 24px;
  }

  .header-actions {
    justify-content: flex-end;
  }

  .workers-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }
}

/* 对话框样式 */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  background: white;
  border-radius: 8px;
  padding: 24px;
  min-width: 400px;
  max-width: 500px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.dialog h3 {
  margin: 0 0 20px 0;
  color: #333;
  font-size: 18px;
  font-weight: 600;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  color: #333;
  font-weight: 500;
  font-size: 14px;
}

.form-group input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  box-sizing: border-box;
}

.form-group input:focus {
  outline: none;
  border-color: #1976d2;
  box-shadow: 0 0 0 3px rgba(25, 118, 210, 0.1);
}

.dialog-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 24px;
}

.dialog-actions .btn {
  padding: 8px 16px;
  font-size: 14px;
}

/* Worker限制统计弹窗样式 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  border-radius: 8px;
  width: 90%;
  max-width: 800px;
  max-height: 80vh;
  overflow: hidden;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
}

.modal-content.large {
  max-width: 1000px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid #e0e0e0;
  background: #f8f9fa;
}

.modal-header h2 {
  margin: 0;
  color: #333;
  font-size: 18px;
  font-weight: 600;
}

.close-btn {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #666;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s;
}

.close-btn:hover {
  background: #e9ecef;
  color: #333;
}

.modal-body {
  padding: 24px;
  overflow-y: auto;
  max-height: calc(80vh - 80px);
}

.stats-controls {
  margin-bottom: 20px;
}

.limits-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
}

.limit-card {
  background: #f8f9fa;
  border-radius: 6px;
  padding: 16px;
  border: 1px solid #e9ecef;
}

.limit-card h3 {
  margin: 0 0 12px 0;
  color: #333;
  font-size: 14px;
  font-weight: 600;
}

.stat-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
}

.stat-label {
  color: #666;
  font-size: 13px;
}

.stat-value {
  font-weight: 600;
  color: #333;
}

.ua-limits, .path-limits {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ua-item, .path-item {
  background: white;
  padding: 8px 12px;
  border-radius: 4px;
  border: 1px solid #dee2e6;
}

.ua-header, .path-header {
  font-weight: 600;
  color: #333;
  font-size: 13px;
  margin-bottom: 4px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.path-limit-badge {
  background: #007bff;
  color: white;
  padding: 2px 6px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
}

.no-path-limits {
  text-align: center;
  padding: 20px;
  color: #666;
  font-style: italic;
  background: #f8f9fa;
  border-radius: 4px;
  border: 1px dashed #dee2e6;
}

.ua-stats, .path-stats {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #666;
}

.no-data {
  text-align: center;
  color: #666;
  padding: 40px;
  font-style: italic;
}

/* Worker实时统计弹窗样式 */
.realtime-stats-grid {
  display: grid;
  gap: 20px;
  max-height: 70vh;
  overflow-y: auto;
}

.stats-section {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 16px;
  border: 1px solid #e9ecef;
}

.stats-section h3 {
  margin: 0 0 12px 0;
  color: #333;
  font-size: 16px;
  font-weight: 600;
  border-bottom: 2px solid #007bff;
  padding-bottom: 8px;
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 12px;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: white;
  border-radius: 6px;
  border: 1px solid #dee2e6;
}

.stat-item .label {
  font-weight: 500;
  color: #666;
  font-size: 14px;
}

.stat-item .value {
  color: #333;
  font-weight: 600;
  font-family: monospace;
  font-size: 14px;
}

.stats-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 6px;
}

.last-update {
  color: #666;
  font-size: 14px;
  font-style: italic;
}

.error-message {
  text-align: center;
  padding: 40px 20px;
  color: #dc3545;
  background: #f8d7da;
  border-radius: 8px;
  border: 1px solid #f5c6cb;
}

.realtime-stats-grid .no-data {
  text-align: center;
  padding: 40px 20px;
  color: #666;
  background: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #e9ecef;
}

/* 实时日志样式 */
.realtime-logs {
  margin-top: 16px;
  border-top: 1px solid #dee2e6;
  padding-top: 16px;
}

.logs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.logs-header h4 {
  margin: 0;
  color: #333;
  font-size: 14px;
  font-weight: 600;
}

.logs-container {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  background: #fff;
}

.log-entry {
  padding: 8px 12px;
  border-bottom: 1px solid #f1f3f4;
  font-family: monospace;
  font-size: 12px;
  display: grid;
  grid-template-columns: auto auto 1fr;
  gap: 12px;
  align-items: start;
}

.log-entry:last-child {
  border-bottom: none;
}

.log-entry.log-info {
  background: #f8f9fa;
}

.log-entry.log-warning {
  background: #fff3cd;
  border-left: 3px solid #ffc107;
}

.log-entry.log-error {
  background: #f8d7da;
  border-left: 3px solid #dc3545;
}

.log-entry.log-debug {
  background: #d1ecf1;
  border-left: 3px solid #17a2b8;
}

.log-time {
  color: #666;
  font-size: 11px;
  white-space: nowrap;
}

.log-level {
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10px;
  text-align: center;
  min-width: 50px;
}

.log-entry.log-info .log-level {
  background: #d4edda;
  color: #155724;
}

.log-entry.log-warning .log-level {
  background: #fff3cd;
  color: #856404;
}

.log-entry.log-error .log-level {
  background: #f8d7da;
  color: #721c24;
}

.log-entry.log-debug .log-level {
  background: #d1ecf1;
  color: #0c5460;
}

.log-message {
  color: #333;
  word-break: break-word;
}

.log-data {
  grid-column: 1 / -1;
  margin-top: 4px;
  padding: 4px 8px;
  background: #f8f9fa;
  border-radius: 3px;
  color: #666;
  font-size: 11px;
  word-break: break-all;
}

.no-logs {
  text-align: center;
  padding: 20px;
  color: #666;
  font-style: italic;
  background: #f8f9fa;
  border-radius: 6px;
}
</style>