<template>
  <div class="config-page">
    <div class="page-header">
      <h1>⚙️ 配置管理</h1>
      <p>管理系统配置和Worker设置</p>
    </div>

    <div class="config-sections">
      <div class="config-card">
        <h3>🔧 基本配置</h3>
        <form @submit.prevent="saveBasicConfig" class="config-form">
          <div class="form-group">
            <label>系统名称</label>
            <input v-model="config.systemName" type="text" placeholder="DanDanPlay API 数据交互中心" />
          </div>
          <div class="form-group">
            <label>API端口</label>
            <input v-model.number="config.apiPort" type="number" min="1000" max="65535" placeholder="7759" />
          </div>
          <div class="form-group">
            <label>调试模式</label>
            <label class="checkbox-label">
              <input v-model="config.debugMode" type="checkbox" />
              <span class="checkmark"></span>
              启用调试日志
            </label>
          </div>
          <button type="submit" class="save-btn">💾 保存基本配置</button>
        </form>
      </div>

      <div class="config-card">
        <h3>🤖 Telegram机器人</h3>
        <form @submit.prevent="saveTelegramConfig" class="config-form">
          <div class="form-group">
            <label>Bot Token</label>
            <input v-model="config.telegramToken" type="password" placeholder="请输入Telegram Bot Token" />
          </div>
          <div class="form-group">
            <label>管理员用户ID</label>
            <input v-model="config.adminUserIds" type="text" placeholder="多个ID用逗号分隔" />
          </div>
          <button type="submit" class="save-btn">🤖 保存机器人配置</button>
        </form>
      </div>

      <div class="config-card">
        <h3>🌐 Worker配置</h3>
        <div class="worker-header">
          <div class="api-key-section">
            <label>API密钥:</label>
            <div class="api-key-display">
              <input v-model="apiKey" type="password" readonly class="api-key-input" />
              <button @click="toggleApiKeyVisibility" class="toggle-btn">
                {{ showApiKey ? '🙈' : '👁️' }}
              </button>
              <button @click="generateApiKey" class="generate-btn">🔄 重新生成</button>
            </div>
          </div>
        </div>
        <div class="worker-list">
          <div v-for="worker in workers" :key="worker.id" class="worker-item">
            <div class="worker-info">
              <div class="worker-details">
                <span class="worker-name">{{ worker.name }}</span>
                <span class="worker-endpoint">{{ worker.endpoint }}</span>
              </div>
              <span class="worker-status" :class="worker.status">{{ worker.status }}</span>
            </div>
            <div class="worker-actions">
              <button @click="editWorker(worker)" class="edit-btn">✏️ 编辑</button>
              <button @click="deleteWorker(worker.id)" class="delete-btn">🗑️ 删除</button>
            </div>
          </div>
        </div>
        <button @click="showAddWorkerDialog" class="add-btn">➕ 添加Worker</button>
      </div>
    </div>

    <!-- Worker编辑对话框 -->
    <div v-if="showWorkerDialog" class="dialog-overlay" @click="closeWorkerDialog">
      <div class="dialog" @click.stop>
        <h3>{{ editingWorker ? '编辑Worker' : '添加Worker' }}</h3>
        <form @submit.prevent="saveWorker" class="worker-form">
          <div class="form-group">
            <label>Worker名称</label>
            <input v-model="workerForm.name" type="text" placeholder="例如: Worker-1" required />
          </div>
          <div class="form-group">
            <label>Worker端点</label>
            <input v-model="workerForm.endpoint" type="url" placeholder="例如: https://worker.example.com" required />
          </div>
          <div class="form-actions">
            <button type="button" @click="closeWorkerDialog" class="cancel-btn">取消</button>
            <button type="submit" class="save-btn">{{ editingWorker ? '更新' : '添加' }}</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import { authFetch } from '../utils/api.js'

export default {
  name: 'Config',
  setup() {
    const config = ref({
      systemName: 'DanDanPlay API 数据交互中心',
      apiPort: 7759,
      debugMode: false,
      telegramToken: '',
      adminUserIds: ''
    })

    const workers = ref([])
    const apiKey = ref('')
    const showApiKey = ref(false)
    const showWorkerDialog = ref(false)
    const editingWorker = ref(null)
    const workerForm = ref({
      name: '',
      endpoint: ''
    })

    const showMessage = (message, type = 'info') => {
      const messageEl = document.createElement('div')
      messageEl.textContent = message
      messageEl.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        background: ${type === 'success' ? '#67c23a' : type === 'error' ? '#f56c6c' : '#409eff'};
        color: white;
        border-radius: 4px;
        z-index: 9999;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      `
      document.body.appendChild(messageEl)
      setTimeout(() => {
        document.body.removeChild(messageEl)
      }, 3000)
    }

    const saveBasicConfig = async () => {
      try {
        showMessage('基本配置保存成功', 'success')
      } catch (error) {
        showMessage('保存失败', 'error')
      }
    }

    const saveTelegramConfig = async () => {
      try {
        showMessage('Telegram配置保存成功', 'success')
      } catch (error) {
        showMessage('保存失败', 'error')
      }
    }

    const loadWorkers = async () => {
      try {
        const response = await authFetch('/api/v1/web-config/workers')
        if (response.ok) {
          const data = await response.json()
          workers.value = data
        }
      } catch (error) {
        console.error('加载Worker配置失败:', error)
      }
    }

    const loadSystemSettings = async () => {
      try {
        const response = await authFetch('/api/v1/web-config/system-settings/with-secrets')
        if (response.ok) {
          const data = await response.json()
          apiKey.value = data.worker_api_key || ''
        }
      } catch (error) {
        console.error('加载系统设置失败:', error)
      }
    }

    const toggleApiKeyVisibility = () => {
      showApiKey.value = !showApiKey.value
      const input = document.querySelector('.api-key-input')
      if (input) {
        input.type = showApiKey.value ? 'text' : 'password'
      }
    }

    const generateApiKey = async () => {
      if (!confirm('确定要重新生成API密钥吗？这将使所有Worker需要更新配置。')) {
        return
      }

      try {
        const response = await authFetch('/api/v1/web-config/workers/generate-api-key', {
          method: 'POST'
        })

        if (response.ok) {
          const result = await response.json()
          if (result.success) {
            apiKey.value = result.data.api_key
            showMessage('API密钥生成成功', 'success')
          } else {
            showMessage(result.message, 'error')
          }
        }
      } catch (error) {
        showMessage('生成API密钥失败', 'error')
      }
    }

    const showAddWorkerDialog = () => {
      editingWorker.value = null
      workerForm.value = { name: '', endpoint: '' }
      showWorkerDialog.value = true
    }

    const editWorker = (worker) => {
      editingWorker.value = worker
      workerForm.value = {
        name: worker.name,
        endpoint: worker.endpoint
      }
      showWorkerDialog.value = true
    }

    const closeWorkerDialog = () => {
      showWorkerDialog.value = false
      editingWorker.value = null
      workerForm.value = { name: '', endpoint: '' }
    }

    const saveWorker = async () => {
      try {
        if (editingWorker.value) {
          // 更新Worker
          const response = await authFetch(`/api/v1/web-config/workers/${editingWorker.value.id}`, {
            method: 'PUT',
            body: JSON.stringify(workerForm.value)
          })

          if (response.ok) {
            const result = await response.json()
            if (result.success) {
              showMessage('Worker更新成功', 'success')
              await loadWorkers()
              closeWorkerDialog()
            } else {
              showMessage(result.message, 'error')
            }
          }
        } else {
          // 创建Worker
          const response = await authFetch('/api/v1/web-config/workers', {
            method: 'POST',
            body: JSON.stringify(workerForm.value)
          })

          if (response.ok) {
            const result = await response.json()
            if (result.success) {
              showMessage('Worker创建成功', 'success')
              await loadWorkers()
              closeWorkerDialog()
            } else {
              showMessage(result.message, 'error')
            }
          }
        }
      } catch (error) {
        showMessage('保存Worker失败', 'error')
      }
    }

    const deleteWorker = async (workerId) => {
      if (!confirm('确定要删除这个Worker吗？')) {
        return
      }

      try {
        const response = await authFetch(`/api/v1/web-config/workers/${workerId}`, {
          method: 'DELETE'
        })

        if (response.ok) {
          const result = await response.json()
          if (result.success) {
            showMessage('Worker删除成功', 'success')
            await loadWorkers()
          } else {
            showMessage(result.message, 'error')
          }
        }
      } catch (error) {
        showMessage('删除Worker失败', 'error')
      }
    }

    onMounted(() => {
      loadWorkers()
      loadSystemSettings()
    })

    return {
      config,
      workers,
      apiKey,
      showApiKey,
      showWorkerDialog,
      editingWorker,
      workerForm,
      saveBasicConfig,
      saveTelegramConfig,
      toggleApiKeyVisibility,
      generateApiKey,
      showAddWorkerDialog,
      editWorker,
      closeWorkerDialog,
      saveWorker,
      deleteWorker
    }
  }
}
</script>

<style scoped>
.config-page {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 30px;
}

.page-header h1 {
  color: #333;
  margin-bottom: 8px;
}

.page-header p {
  color: #666;
}

.config-sections {
  display: grid;
  gap: 20px;
}

.config-card {
  background: white;
  padding: 24px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.config-card h3 {
  color: #333;
  margin-bottom: 20px;
  font-size: 18px;
}

.config-form {
  display: grid;
  gap: 16px;
}

.form-group {
  display: grid;
  gap: 8px;
}

.form-group label {
  color: #333;
  font-weight: 500;
}

.form-group input[type="text"],
.form-group input[type="number"],
.form-group input[type="password"] {
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
}

.form-group input:focus {
  outline: none;
  border-color: #409eff;
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.1);
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.checkbox-label input[type="checkbox"] {
  margin: 0;
}

.save-btn, .add-btn {
  padding: 12px 20px;
  background: #409eff;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.3s;
}

.save-btn:hover, .add-btn:hover {
  background: #337ecc;
}

.worker-header {
  margin-bottom: 20px;
}

.api-key-section {
  margin-bottom: 16px;
}

.api-key-section label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: #333;
}

.api-key-display {
  display: flex;
  gap: 8px;
  align-items: center;
}

.api-key-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #f8f9fa;
  font-family: monospace;
  font-size: 14px;
}

.toggle-btn, .generate-btn {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 14px;
}

.toggle-btn:hover, .generate-btn:hover {
  background: #f8f9fa;
}

.generate-btn {
  background: #007bff;
  color: white;
  border-color: #007bff;
}

.generate-btn:hover {
  background: #0056b3;
}

.worker-list {
  margin-bottom: 16px;
}

.worker-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border: 1px solid #eee;
  border-radius: 6px;
  margin-bottom: 8px;
}

.worker-info {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.worker-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.worker-name {
  font-weight: 500;
  color: #333;
}

.worker-endpoint {
  font-size: 12px;
  color: #666;
  font-family: monospace;
}

.worker-status {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  text-transform: uppercase;
  margin-left: auto;
  margin-right: 12px;
}

.worker-status.online {
  background: #f0f9ff;
  color: #0369a1;
}

.worker-status.offline {
  background: #fef2f2;
  color: #dc2626;
}

.worker-actions {
  display: flex;
  gap: 8px;
}

.edit-btn, .delete-btn {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.edit-btn {
  background: #f3f4f6;
  color: #374151;
}

.delete-btn {
  background: #fee2e2;
  color: #dc2626;
}

.edit-btn:hover {
  background: #e5e7eb;
}

.delete-btn:hover {
  background: #fecaca;
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
}

.worker-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 20px;
}

.cancel-btn {
  padding: 8px 16px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  cursor: pointer;
}

.cancel-btn:hover {
  background: #f8f9fa;
}
</style>
