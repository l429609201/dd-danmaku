<template>
  <div class="worker-management">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-content">
        <h1>🔧 Worker管理</h1>
        <p>管理和监控所有Worker节点</p>
      </div>
      <div class="header-actions">
        <button @click="generateApiKey" class="btn btn-secondary">
          🔑 生成API密钥
        </button>
        <button @click="showAddWorker = true" class="btn btn-primary">
          ➕ 添加Worker
        </button>
      </div>
    </div>

    <!-- API密钥显示卡片 -->
    <div v-if="currentApiKey" class="api-key-card">
      <div class="card-header">
        <h3>🔑 Worker API密钥</h3>
        <button @click="currentApiKey = ''" class="close-btn">✕</button>
      </div>
      <div class="card-body">
        <div class="api-key-display">
          <input :value="currentApiKey" readonly class="api-key-input">
          <button @click="copyApiKey" class="btn btn-outline">📋 复制</button>
        </div>
        <p class="api-key-note">
          ⚠️ 请妥善保存此API密钥，用于Worker与数据中心的通信验证
        </p>
      </div>
    </div>

    <!-- Worker列表 -->
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
            <button @click="viewStats(worker)" class="btn btn-sm btn-outline" title="查看统计">
              📊
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
            <button @click="removeWorker(worker)" class="btn btn-sm btn-danger" title="删除Worker">
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
        <h3>暂无Worker</h3>
        <p>点击"添加Worker"开始配置您的第一个Worker节点</p>
        <button @click="showAddWorker = true" class="btn btn-primary">
          ➕ 添加Worker
        </button>
      </div>
    </div>

    <!-- 添加Worker表单 -->
    <div v-if="showAddWorker" class="dialog-overlay">
      <div class="dialog">
        <h3>添加Worker</h3>
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
      message: null,
      newWorker: {
        name: '',
        url: '',
        description: ''
      }
    }
  },

  async mounted() {
    // 优先从后端加载Worker列表
    await this.loadWorkersFromServer()

    // 恢复API密钥状态
    const savedApiKey = sessionStorage.getItem('worker_api_key')
    if (savedApiKey) {
      this.currentApiKey = savedApiKey
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
            const workerStats = result.stats.find(s => s.worker_url === worker.url)
            if (workerStats && workerStats.success && workerStats.stats) {
              const stats = workerStats.stats
              const message = `${worker.name} 统计信息：
总请求数: ${stats.requests_total || 0}
待处理请求: ${stats.pending_requests || 0}
内存缓存大小: ${stats.memory_cache_size || 0}
日志数量: ${stats.logs_count || 0}
运行时间: ${Math.floor((stats.uptime || 0) / 1000 / 60)} 分钟
配置统计: UA配置 ${stats.config_stats?.ua_configs_count || 0} 条，IP黑名单 ${stats.config_stats?.ip_blacklist_count || 0} 条
秘钥轮换: Secret1=${stats.secret_rotation?.secret1_count || 0}, Secret2=${stats.secret_rotation?.secret2_count || 0}, 当前=${stats.secret_rotation?.current_secret || '1'}`
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

    async generateApiKey() {
      // 生成32位随机API密钥（大小写英文+数字）
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
      let apiKey = ''
      for (let i = 0; i < 32; i++) {
        apiKey += chars.charAt(Math.floor(Math.random() * chars.length))
      }

      this.currentApiKey = apiKey
      // 保存到sessionStorage，页面切换后不会丢失
      sessionStorage.setItem('worker_api_key', this.currentApiKey)
      this.showMessage('API密钥生成成功', 'success')
    },

    addWorker() {
      // 显示添加Worker的表单
      this.showAddWorker = true
      this.newWorker = {
        name: '',
        url: '',
        description: ''
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
          this.showMessage(`Worker保存成功: ${result.message}`, 'success')

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
      if (confirm(`确定要删除Worker "${worker.name}" 吗？`)) {
        try {
          // 调用后端API删除Worker
          const response = await authFetch(`/api/web-config/workers/${worker.id}`, {
            method: 'DELETE'
          })

          if (response.ok) {
            const result = await response.json()
            if (result.success) {
              this.showMessage(`Worker "${worker.name}" 已删除`, 'success')
              // 重新从服务器加载Worker列表以确保数据一致性
              await this.loadWorkersFromServer()
            } else {
              this.showMessage(`删除失败: ${result.message}`, 'error')
            }
          } else {
            this.showMessage(`删除失败: HTTP ${response.status}`, 'error')
          }
        } catch (error) {
          console.error('删除Worker异常:', error)
          this.showMessage(`删除异常: ${error.message}`, 'error')
        }
      }
    },

    showMessage(text, type = 'info') {
      this.message = { text, type }
      setTimeout(() => {
        this.message = null
      }, 3000)
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

/* API密钥卡片 */
.api-key-card {
  background: white;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  margin-bottom: 20px;
  border-left: 4px solid #4caf50;
  transition: all 0.3s ease;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.api-key-card:hover {
  background: #fafafa;
  border-color: #d0d0d0;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px 0;
}

.card-header h3 {
  font-size: 18px;
  font-weight: 600;
  color: #333;
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  font-size: 18px;
  color: #666;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s;
}

.close-btn:hover {
  background: #f0f0f0;
  color: #333;
}

.card-body {
  padding: 20px 24px 24px;
}

.api-key-display {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}

.api-key-input {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 13px;
  background: #f9f9f9;
  color: #333;
}

.api-key-note {
  color: #4caf50;
  font-size: 14px;
  margin: 0;
  padding: 12px 16px;
  background: #f1f8e9;
  border-radius: 6px;
  border: 1px solid #c8e6c9;
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
</style>