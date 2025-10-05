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
            <button @click="pushConfig(worker)" class="btn btn-sm btn-primary" title="推送配置">
              🚀
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

    <!-- 添加Worker模态框 -->
    <div v-if="showAddWorker" class="modal-overlay" @click="showAddWorker = false">
      <div class="modal" @click.stop>
        <div class="modal-header">
          <h3>➕ 添加Worker</h3>
          <button @click="showAddWorker = false" class="close-btn">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Worker名称</label>
            <input v-model="newWorker.name" type="text" placeholder="例如: 主Worker" class="form-input">
          </div>
          <div class="form-group">
            <label>Worker URL</label>
            <input v-model="newWorker.url" type="url" placeholder="https://your-worker.workers.dev" class="form-input">
          </div>
          <div class="form-group">
            <label>API密钥</label>
            <input v-model="newWorker.apiKey" type="password" placeholder="Worker API密钥" class="form-input">
          </div>
        </div>
        <div class="modal-footer">
          <button @click="showAddWorker = false" class="btn btn-outline">取消</button>
          <button @click="addWorker" class="btn btn-primary">添加</button>
        </div>
      </div>
    </div>

    <!-- 推送配置模态框 -->
    <div v-if="showPushConfig" class="modal-overlay" @click="showPushConfig = false">
      <div class="modal modal-large" @click.stop>
        <div class="modal-header">
          <h3>🚀 推送配置到 {{ currentWorker?.name }}</h3>
          <button @click="showPushConfig = false" class="close-btn">✕</button>
        </div>
        <div class="modal-body">
          <div class="config-section">
            <label>UA配置</label>
            <textarea v-model="pushConfigData.uaConfigsText" rows="8" placeholder="UA配置JSON格式" class="config-textarea"></textarea>
          </div>
          <div class="config-section">
            <label>IP黑名单</label>
            <textarea v-model="pushConfigData.ipBlacklistText" rows="5" placeholder="IP黑名单JSON格式" class="config-textarea"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button @click="loadCurrentConfig" class="btn btn-outline">加载当前配置</button>
          <button @click="showPushConfig = false" class="btn btn-outline">取消</button>
          <button @click="executePushConfig" class="btn btn-primary">推送配置</button>
        </div>
      </div>
    </div>

    <!-- 统计信息模态框 -->
    <div v-if="showStats" class="modal-overlay" @click="showStats = false">
      <div class="modal" @click.stop>
        <div class="modal-header">
          <h3>📊 {{ currentWorker?.name }} 统计信息</h3>
          <button @click="showStats = false" class="close-btn">✕</button>
        </div>
        <div class="modal-body">
          <div v-if="workerStats" class="stats-grid">
            <div class="stat-card">
              <div class="stat-value">{{ workerStats.requests_total }}</div>
              <div class="stat-label">请求总数</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">{{ workerStats.memory_cache_size }}</div>
              <div class="stat-label">缓存大小</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">Secret{{ workerStats.secret_rotation?.current_secret }}</div>
              <div class="stat-label">当前秘钥</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">{{ workerStats.secret_rotation?.secret1_count }}</div>
              <div class="stat-label">秘钥1使用次数</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">{{ workerStats.secret_rotation?.secret2_count }}</div>
              <div class="stat-label">秘钥2使用次数</div>
            </div>
            <div class="stat-card">
              <div class="stat-value">{{ workerStats.secret_rotation?.rotation_limit }}</div>
              <div class="stat-label">轮换限制</div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button @click="showStats = false" class="btn btn-primary">关闭</button>
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
      showPushConfig: false,
      showStats: false,
      currentWorker: null,
      workerStats: null,
      currentApiKey: '',
      newWorker: {
        name: '',
        url: '',
        apiKey: ''
      },
      pushConfigData: {
        uaConfigsText: '',
        ipBlacklistText: ''
      },
      message: null
    }
  },

  mounted() {
    this.loadWorkers()
  },

  methods: {
    async loadWorkers() {
      try {
        const response = await authFetch('/api/v1/worker/workers')
        if (response.ok) {
          const data = await response.json()
          this.workers = data.workers || []
        }
      } catch (error) {
        this.showMessage('加载Worker列表失败', 'error')
      }
    },

    async testConnection(worker) {
      try {
        const response = await authFetch('/api/v1/worker/test-connection', {
          method: 'POST',
          body: JSON.stringify({
            worker_url: worker.url,
            api_key: worker.apiKey || 'test-key'
          })
        })

        const result = await response.json()
        if (result.success) {
          this.showMessage('Worker连接成功', 'success')
          worker.status = 'online'
        } else {
          this.showMessage(result.message, 'error')
          worker.status = 'offline'
        }
      } catch (error) {
        this.showMessage('连接测试失败', 'error')
        worker.status = 'error'
      }
    },

    pushConfig(worker) {
      this.currentWorker = worker
      this.showPushConfig = true
      this.loadCurrentConfig()
    },

    async loadCurrentConfig() {
      try {
        const uaResponse = await authFetch('/api/v1/config/ua')
        if (uaResponse.ok) {
          const uaData = await uaResponse.json()
          this.pushConfigData.uaConfigsText = JSON.stringify(uaData.configs || {}, null, 2)
        }

        const ipResponse = await authFetch('/api/v1/config/ip-blacklist')
        if (ipResponse.ok) {
          const ipData = await ipResponse.json()
          this.pushConfigData.ipBlacklistText = JSON.stringify(ipData.blacklist || [], null, 2)
        }
      } catch (error) {
        this.showMessage('加载当前配置失败', 'error')
      }
    },

    async executePushConfig() {
      try {
        let uaConfigs = {}
        let ipBlacklist = []

        if (this.pushConfigData.uaConfigsText.trim()) {
          uaConfigs = JSON.parse(this.pushConfigData.uaConfigsText)
        }

        if (this.pushConfigData.ipBlacklistText.trim()) {
          ipBlacklist = JSON.parse(this.pushConfigData.ipBlacklistText)
        }

        const response = await authFetch('/api/v1/worker/push-config', {
          method: 'POST',
          body: JSON.stringify({
            worker_url: this.currentWorker.url,
            api_key: this.currentWorker.apiKey || 'test-key',
            ua_configs: uaConfigs,
            ip_blacklist: ipBlacklist
          })
        })

        const result = await response.json()
        if (result.success) {
          this.showMessage('配置推送成功', 'success')
          this.showPushConfig = false
        } else {
          this.showMessage(result.message, 'error')
        }
      } catch (error) {
        this.showMessage('配置推送失败: ' + error.message, 'error')
      }
    },

    async viewStats(worker) {
      this.currentWorker = worker
      try {
        const response = await authFetch(`/api/v1/worker/stats/${worker.id}`)
        if (response.ok) {
          const data = await response.json()
          this.workerStats = data.stats
          this.showStats = true
        } else {
          this.showMessage('获取统计信息失败', 'error')
        }
      } catch (error) {
        this.showMessage('获取统计信息失败', 'error')
      }
    },

    addWorker() {
      if (!this.newWorker.name || !this.newWorker.url || !this.newWorker.apiKey) {
        this.showMessage('请填写完整信息', 'error')
        return
      }

      const worker = {
        id: 'worker-' + Date.now(),
        name: this.newWorker.name,
        url: this.newWorker.url,
        apiKey: this.newWorker.apiKey,
        status: 'unknown',
        lastSync: null
      }

      this.workers.push(worker)
      this.showAddWorker = false
      this.newWorker = { name: '', url: '', apiKey: '' }
      this.showMessage('Worker添加成功', 'success')
    },

    async generateApiKey() {
      try {
        const response = await authFetch('/api/v1/worker/generate-api-key', {
          method: 'POST'
        })
        const result = await response.json()
        if (result.success) {
          this.currentApiKey = result.api_key
          this.showMessage('API密钥生成成功', 'success')
        } else {
          this.showMessage(result.message, 'error')
        }
      } catch (error) {
        this.showMessage('生成API密钥失败', 'error')
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
  background: #f8fafc;
  min-height: 100vh;
}

/* 页面头部 */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 32px;
  padding: 24px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.header-content h1 {
  font-size: 28px;
  font-weight: 700;
  color: #1a202c;
  margin: 0 0 8px 0;
}

.header-content p {
  color: #718096;
  margin: 0;
  font-size: 16px;
}

.header-actions {
  display: flex;
  gap: 12px;
}

/* 按钮样式 */
.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.btn-primary {
  background: #4f46e5;
  color: white;
}

.btn-primary:hover {
  background: #4338ca;
  transform: translateY(-1px);
}

.btn-secondary {
  background: #6b7280;
  color: white;
}

.btn-secondary:hover {
  background: #4b5563;
}

.btn-outline {
  background: white;
  color: #374151;
  border: 1px solid #d1d5db;
}

.btn-outline:hover {
  background: #f9fafb;
  border-color: #9ca3af;
}

.btn-sm {
  padding: 6px 12px;
  font-size: 12px;
}

/* API密钥卡片 */
.api-key-card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  margin-bottom: 24px;
  border-left: 4px solid #10b981;
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
  color: #1a202c;
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  font-size: 18px;
  color: #9ca3af;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}

.close-btn:hover {
  background: #f3f4f6;
  color: #374151;
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
  padding: 12px 16px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 14px;
  background: #f9fafb;
}

.api-key-note {
  color: #059669;
  font-size: 14px;
  margin: 0;
  padding: 12px 16px;
  background: #ecfdf5;
  border-radius: 8px;
}

/* Worker网格 */
.workers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 24px;
}

.worker-card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  transition: all 0.2s;
}

.worker-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transform: translateY(-2px);
}

.worker-card .card-header {
  padding: 20px 24px 16px;
  border-bottom: 1px solid #f3f4f6;
}

.worker-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.worker-info h3 {
  font-size: 18px;
  font-weight: 600;
  color: #1a202c;
  margin: 0;
}

.status-badge {
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
}

.status-badge.online {
  background: #d1fae5;
  color: #065f46;
}

.status-badge.offline {
  background: #fee2e2;
  color: #991b1b;
}

.status-badge.error {
  background: #fef3c7;
  color: #92400e;
}

.status-badge.unknown {
  background: #f3f4f6;
  color: #374151;
}

.worker-actions {
  display: flex;
  gap: 8px;
}

.worker-card .card-body {
  padding: 16px 24px 20px;
}

.worker-url {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.worker-url .label {
  font-size: 14px;
  color: #6b7280;
  font-weight: 500;
}

.worker-url code {
  background: #f3f4f6;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 13px;
  color: #374151;
}

.worker-meta {
  display: flex;
  gap: 16px;
}

.meta-item {
  font-size: 14px;
  color: #6b7280;
}

.meta-item .label {
  font-weight: 500;
}

/* 空状态 */
.empty-state {
  grid-column: 1 / -1;
  text-align: center;
  padding: 60px 20px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 16px;
}

.empty-state h3 {
  font-size: 20px;
  font-weight: 600;
  color: #1a202c;
  margin: 0 0 8px 0;
}

.empty-state p {
  color: #6b7280;
  margin: 0 0 24px 0;
}

/* 模态框 */
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
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 12px;
  width: 90%;
  max-width: 500px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
}

.modal-large {
  max-width: 700px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px;
  border-bottom: 1px solid #f3f4f6;
}

.modal-header h3 {
  font-size: 20px;
  font-weight: 600;
  color: #1a202c;
  margin: 0;
}

.modal-body {
  padding: 24px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 24px;
  border-top: 1px solid #f3f4f6;
  background: #f9fafb;
  border-radius: 0 0 12px 12px;
}

/* 表单 */
.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: #374151;
  font-size: 14px;
}

.form-input {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
  transition: border-color 0.2s;
}

.form-input:focus {
  outline: none;
  border-color: #4f46e5;
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
}

.config-section {
  margin-bottom: 24px;
}

.config-section label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: #374151;
  font-size: 14px;
}

.config-textarea {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 13px;
  resize: vertical;
  min-height: 120px;
}

.config-textarea:focus {
  outline: none;
  border-color: #4f46e5;
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
}

/* 统计网格 */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 16px;
}

.stat-card {
  background: #f8fafc;
  padding: 20px;
  border-radius: 8px;
  text-align: center;
  border: 1px solid #e2e8f0;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: #1a202c;
  margin-bottom: 4px;
}

.stat-label {
  font-size: 12px;
  color: #6b7280;
  text-transform: uppercase;
  font-weight: 500;
  letter-spacing: 0.5px;
}

/* 消息提示 */
.toast {
  position: fixed;
  top: 24px;
  right: 24px;
  padding: 16px 20px;
  border-radius: 8px;
  font-weight: 500;
  z-index: 1001;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  animation: slideIn 0.3s ease-out;
}

.toast.success {
  background: #10b981;
  color: white;
}

.toast.error {
  background: #ef4444;
  color: white;
}

.toast.info {
  background: #3b82f6;
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
    gap: 16px;
    align-items: stretch;
  }

  .header-actions {
    justify-content: flex-end;
  }

  .workers-grid {
    grid-template-columns: 1fr;
  }

  .modal {
    width: 95%;
    margin: 20px;
  }

  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>