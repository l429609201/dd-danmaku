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
            <button @click="pushConfig(worker)" class="btn btn-sm btn-primary" title="推送配置">
              🚀
            </button>
            <button @click="fullSync(worker)" class="btn btn-sm btn-success" title="完整同步">
              🔄
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

  mounted() {
    this.loadWorkers()
    // 恢复API密钥状态
    const savedApiKey = sessionStorage.getItem('worker_api_key')
    if (savedApiKey) {
      this.currentApiKey = savedApiKey
    }

    // 恢复Worker列表
    const savedWorkers = localStorage.getItem('worker_list')
    if (savedWorkers) {
      try {
        this.workers = JSON.parse(savedWorkers)
      } catch (e) {
        console.error('恢复Worker列表失败:', e)
      }
    }
  },

  methods: {
    async loadWorkers() {
      // 模拟数据，避免API调用问题
      this.workers = []
    },

    async testConnection(worker) {
      this.showMessage('测试连接功能', 'info')
    },

    pushConfig(worker) {
      this.showMessage('推送配置功能', 'info')
    },

    async viewStats(worker) {
      this.showMessage('查看统计功能', 'info')
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

    saveWorker() {
      if (!this.newWorker.name || !this.newWorker.url) {
        this.showMessage('请填写Worker名称和URL', 'error')
        return
      }

      // 添加新的Worker
      const worker = {
        id: Date.now(),
        name: this.newWorker.name,
        url: this.newWorker.url,
        description: this.newWorker.description,
        status: 'unknown',
        lastSync: '从未同步',
        version: '未知'
      }

      this.workers.push(worker)

      // 保存到localStorage
      localStorage.setItem('worker_list', JSON.stringify(this.workers))

      this.showAddWorker = false
      this.showMessage('Worker添加成功', 'success')
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

    viewStats(worker) {
      this.showMessage(`查看 ${worker.name} 的统计信息`, 'info')
      // 模拟打开统计页面
      setTimeout(() => {
        this.showMessage(`${worker.name} 统计信息：请求数 1234，成功率 98.5%`, 'success')
      }, 500)
    },

    async pushConfig(worker) {
      this.showMessage(`正在向 ${worker.name} 推送配置...`, 'info')

      try {
        // 模拟配置推送
        await new Promise(resolve => setTimeout(resolve, 1500))

        worker.lastSync = new Date().toLocaleString()
        this.showMessage(`向 ${worker.name} 推送配置成功`, 'success')

        // 保存状态
        localStorage.setItem('worker_list', JSON.stringify(this.workers))

      } catch (error) {
        this.showMessage(`向 ${worker.name} 推送配置失败: ${error.message}`, 'error')
      }
    },

    async fetchWorkerLogs(worker) {
      this.showMessage(`正在从 ${worker.name} 获取日志...`, 'info')

      try {
        // 调用真实API获取Worker日志
        const response = await fetch(`${worker.url}/api/logs?limit=50`, {
          method: 'GET',
          headers: {
            'X-API-Key': worker.apiKey || 'default-key',
            'Content-Type': 'application/json'
          }
        })

        if (response.ok) {
          const data = await response.json()
          const logCount = data.logs ? data.logs.length : 0
          this.showMessage(`从 ${worker.name} 获取到 ${logCount} 条日志`, 'success')

          // 可以在这里处理日志数据，比如存储到本地或显示在界面上
          console.log(`${worker.name} 日志:`, data)
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

        // 2. 获取统计数据
        const statsResponse = await fetch(`${worker.url}/api/stats/export`, {
          method: 'GET',
          headers: {
            'X-API-Key': worker.apiKey || 'default-key',
            'Content-Type': 'application/json'
          }
        })

        if (statsResponse.ok) {
          const statsData = await statsResponse.json()
          console.log(`${worker.name} 统计数据:`, statsData)
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