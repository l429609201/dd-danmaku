<template>
  <div class="worker-management">
    <div class="header">
      <h2>Worker管理</h2>
      <div class="header-actions">
        <button @click="generateApiKey" class="btn">生成API密钥</button>
        <button @click="showAddWorker = true" class="btn btn-primary">添加Worker</button>
      </div>
    </div>

    <!-- API密钥显示 -->
    <div v-if="currentApiKey" class="api-key-section">
      <div class="api-key-card">
        <h3>Worker API密钥</h3>
        <div class="api-key-display">
          <input :value="currentApiKey" readonly class="api-key-input">
          <button @click="copyApiKey" class="btn btn-sm">复制</button>
        </div>
        <p class="api-key-note">请妥善保存此API密钥，用于Worker与数据中心的通信验证。</p>
        <button @click="currentApiKey = ''" class="btn btn-sm">关闭</button>
      </div>
    </div>

    <!-- Worker列表 -->
    <div class="worker-list">
      <div v-for="worker in workers" :key="worker.id" class="worker-card">
        <div class="worker-info">
          <h3>{{ worker.name }}</h3>
          <p class="worker-url">{{ worker.url }}</p>
          <span :class="['status', worker.status]">{{ getStatusText(worker.status) }}</span>
        </div>
        
        <div class="worker-actions">
          <button @click="testConnection(worker)" class="btn btn-sm">测试连接</button>
          <button @click="pushConfig(worker)" class="btn btn-sm btn-primary">推送配置</button>
          <button @click="viewStats(worker)" class="btn btn-sm">查看统计</button>
        </div>
      </div>
    </div>

    <!-- 添加Worker弹窗 -->
    <div v-if="showAddWorker" class="modal-overlay" @click="showAddWorker = false">
      <div class="modal" @click.stop>
        <div class="modal-header">
          <h3>添加Worker</h3>
          <button @click="showAddWorker = false" class="close-btn">&times;</button>
        </div>
        
        <div class="modal-body">
          <div class="form-group">
            <label>Worker名称</label>
            <input v-model="newWorker.name" type="text" placeholder="例如：主Worker">
          </div>
          
          <div class="form-group">
            <label>Worker URL</label>
            <input v-model="newWorker.url" type="text" placeholder="https://your-worker.workers.dev">
          </div>
          
          <div class="form-group">
            <label>API密钥</label>
            <input v-model="newWorker.apiKey" type="password" placeholder="Worker API密钥">
          </div>
        </div>
        
        <div class="modal-footer">
          <button @click="showAddWorker = false" class="btn">取消</button>
          <button @click="addWorker" class="btn btn-primary">添加</button>
        </div>
      </div>
    </div>

    <!-- 配置推送弹窗 -->
    <div v-if="showPushConfig" class="modal-overlay" @click="showPushConfig = false">
      <div class="modal large" @click.stop>
        <div class="modal-header">
          <h3>推送配置到 {{ currentWorker?.name }}</h3>
          <button @click="showPushConfig = false" class="close-btn">&times;</button>
        </div>
        
        <div class="modal-body">
          <div class="config-section">
            <h4>UA配置</h4>
            <textarea 
              v-model="pushConfigData.uaConfigsText" 
              rows="10" 
              placeholder="UA配置JSON格式"
              class="config-textarea"
            ></textarea>
          </div>
          
          <div class="config-section">
            <h4>IP黑名单</h4>
            <textarea 
              v-model="pushConfigData.ipBlacklistText" 
              rows="5" 
              placeholder="IP黑名单JSON格式"
              class="config-textarea"
            ></textarea>
          </div>
        </div>
        
        <div class="modal-footer">
          <button @click="loadCurrentConfig" class="btn">加载当前配置</button>
          <button @click="showPushConfig = false" class="btn">取消</button>
          <button @click="executePushConfig" class="btn btn-primary">推送配置</button>
        </div>
      </div>
    </div>

    <!-- 统计信息弹窗 -->
    <div v-if="showStats" class="modal-overlay" @click="showStats = false">
      <div class="modal" @click.stop>
        <div class="modal-header">
          <h3>{{ currentWorker?.name }} 统计信息</h3>
          <button @click="showStats = false" class="close-btn">&times;</button>
        </div>
        
        <div class="modal-body">
          <div v-if="workerStats" class="stats-grid">
            <div class="stat-item">
              <label>请求总数</label>
              <span>{{ workerStats.requests_total }}</span>
            </div>
            
            <div class="stat-item">
              <label>缓存大小</label>
              <span>{{ workerStats.memory_cache_size }}</span>
            </div>
            
            <div class="stat-item">
              <label>当前秘钥</label>
              <span>Secret{{ workerStats.secret_rotation?.current_secret }}</span>
            </div>
            
            <div class="stat-item">
              <label>秘钥1使用次数</label>
              <span>{{ workerStats.secret_rotation?.secret1_count }}</span>
            </div>
            
            <div class="stat-item">
              <label>秘钥2使用次数</label>
              <span>{{ workerStats.secret_rotation?.secret2_count }}</span>
            </div>
            
            <div class="stat-item">
              <label>轮换限制</label>
              <span>{{ workerStats.secret_rotation?.rotation_limit }}</span>
            </div>
          </div>
        </div>
        
        <div class="modal-footer">
          <button @click="showStats = false" class="btn">关闭</button>
        </div>
      </div>
    </div>

    <!-- 消息提示 -->
    <div v-if="message" :class="['message', message.type]">
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
        // 加载当前的UA配置
        const uaResponse = await authFetch('/api/v1/config/ua')
        if (uaResponse.ok) {
          const uaData = await uaResponse.json()
          this.pushConfigData.uaConfigsText = JSON.stringify(uaData.configs || {}, null, 2)
        }
        
        // 加载当前的IP黑名单
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
        
        // 解析UA配置
        if (this.pushConfigData.uaConfigsText.trim()) {
          uaConfigs = JSON.parse(this.pushConfigData.uaConfigsText)
        }
        
        // 解析IP黑名单
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
      // 这里可以添加Worker到数据库
      const worker = {
        id: 'worker-' + Date.now(),
        name: this.newWorker.name,
        url: this.newWorker.url,
        apiKey: this.newWorker.apiKey,
        status: 'unknown'
      }
      
      this.workers.push(worker)
      this.showAddWorker = false
      this.newWorker = { name: '', url: '', apiKey: '' }
      this.showMessage('Worker添加成功', 'success')
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
        // 降级方案：选择文本
        const input = document.querySelector('.api-key-input')
        input.select()
        document.execCommand('copy')
        this.showMessage('API密钥已复制到剪贴板', 'success')
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
  padding: 20px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.api-key-section {
  margin-bottom: 20px;
}

.api-key-card {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 20px;
  background: #f8f9fa;
}

.api-key-card h3 {
  margin: 0 0 15px 0;
  color: #333;
}

.api-key-display {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
}

.api-key-input {
  flex: 1;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-family: monospace;
  background: white;
}

.api-key-note {
  color: #666;
  font-size: 14px;
  margin: 10px 0;
}

.worker-list {
  display: grid;
  gap: 15px;
}

.worker-card {
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 15px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.worker-info h3 {
  margin: 0 0 5px 0;
}

.worker-url {
  color: #666;
  font-size: 14px;
  margin: 5px 0;
}

.status {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: bold;
}

.status.online { background: #d4edda; color: #155724; }
.status.offline { background: #f8d7da; color: #721c24; }
.status.error { background: #fff3cd; color: #856404; }
.status.unknown { background: #e2e3e5; color: #383d41; }

.worker-actions {
  display: flex;
  gap: 10px;
}

.btn {
  padding: 8px 16px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  cursor: pointer;
}

.btn:hover { background: #f8f9fa; }
.btn.btn-primary { background: #007bff; color: white; border-color: #007bff; }
.btn.btn-primary:hover { background: #0056b3; }
.btn.btn-sm { padding: 4px 8px; font-size: 12px; }

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: white;
  border-radius: 8px;
  width: 500px;
  max-height: 80vh;
  overflow-y: auto;
}

.modal.large { width: 700px; }

.modal-header {
  padding: 15px 20px;
  border-bottom: 1px solid #ddd;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
}

.modal-body {
  padding: 20px;
}

.modal-footer {
  padding: 15px 20px;
  border-top: 1px solid #ddd;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.form-group {
  margin-bottom: 15px;
}

.form-group label {
  display: block;
  margin-bottom: 5px;
  font-weight: bold;
}

.form-group input {
  width: 100%;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.config-section {
  margin-bottom: 20px;
}

.config-textarea {
  width: 100%;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  padding: 10px;
  background: #f8f9fa;
  border-radius: 4px;
}

.stat-item label {
  font-weight: bold;
}

.message {
  position: fixed;
  top: 20px;
  right: 20px;
  padding: 10px 20px;
  border-radius: 4px;
  z-index: 1001;
}

.message.success { background: #d4edda; color: #155724; }
.message.error { background: #f8d7da; color: #721c24; }
.message.info { background: #d1ecf1; color: #0c5460; }
</style>
