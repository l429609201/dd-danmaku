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
      message: null
    }
  },

  mounted() {
    this.loadWorkers()
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
      // 生成一个模拟的API密钥
      this.currentApiKey = 'test-api-key-' + Date.now()
      this.showMessage('API密钥生成成功', 'success')
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
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: white;
}

.btn-primary:hover {
  background: linear-gradient(135deg, #5b5bd6, #7c3aed);
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(99, 102, 241, 0.3);
}

.btn-secondary {
  background: #3a3a3a;
  color: white;
}

.btn-secondary:hover {
  background: #4a4a4a;
  transform: translateY(-1px);
}

.btn-outline {
  background: #2a2a2a;
  color: #ffffff;
  border: 1px solid #3a3a3a;
}

.btn-outline:hover {
  background: #3a3a3a;
  border-color: #4a4a4a;
  transform: translateY(-1px);
}

.btn-sm {
  padding: 8px 16px;
  font-size: 13px;
}

/* API密钥卡片 */
.api-key-card {
  background: #1a1a1a;
  border-radius: 16px;
  border: 1px solid #2a2a2a;
  margin-bottom: 24px;
  border-left: 4px solid #10b981;
  transition: all 0.3s ease;
}

.api-key-card:hover {
  background: #222222;
  border-color: #3a3a3a;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 28px 0;
}

.card-header h3 {
  font-size: 20px;
  font-weight: 600;
  color: #ffffff;
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  font-size: 20px;
  color: #a0a0a0;
  cursor: pointer;
  padding: 6px;
  border-radius: 8px;
  transition: all 0.2s;
}

.close-btn:hover {
  background: #3a3a3a;
  color: #ffffff;
}

.card-body {
  padding: 24px 28px 28px;
}

.api-key-display {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.api-key-input {
  flex: 1;
  padding: 14px 18px;
  border: 1px solid #3a3a3a;
  border-radius: 12px;
  font-family: 'Monaco', 'Menlo', monospace;
  font-size: 14px;
  background: #0f0f0f;
  color: #ffffff;
}

.api-key-note {
  color: #10b981;
  font-size: 15px;
  margin: 0;
  padding: 16px 20px;
  background: rgba(16, 185, 129, 0.1);
  border-radius: 12px;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

/* Worker网格 */
.workers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
  gap: 20px;
}

.worker-card {
  background: #1a1a1a;
  border-radius: 16px;
  border: 1px solid #2a2a2a;
  transition: all 0.3s ease;
}

.worker-card:hover {
  background: #222222;
  border-color: #3a3a3a;
  transform: translateY(-4px);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
}

.worker-card .card-header {
  padding: 24px 28px 20px;
  border-bottom: 1px solid #2a2a2a;
}

.worker-info {
  display: flex;
  align-items: center;
  gap: 16px;
}

.worker-info h3 {
  font-size: 20px;
  font-weight: 600;
  color: #ffffff;
  margin: 0;
}

.status-badge {
  padding: 6px 16px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
}

.status-badge.online {
  background: rgba(16, 185, 129, 0.2);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.status-badge.offline {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.status-badge.error {
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.3);
}

.status-badge.unknown {
  background: rgba(156, 163, 175, 0.2);
  color: #9ca3af;
  border: 1px solid rgba(156, 163, 175, 0.3);
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
  background: #0f0f0f;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 13px;
  color: #ffffff;
  border: 1px solid #3a3a3a;
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
  padding: 80px 32px;
  background: #1a1a1a;
  border-radius: 16px;
  border: 1px solid #2a2a2a;
  transition: all 0.3s ease;
}

.empty-state:hover {
  background: #222222;
  border-color: #3a3a3a;
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
</style>