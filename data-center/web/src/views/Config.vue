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
        <div class="worker-list">
          <div v-for="worker in workers" :key="worker.id" class="worker-item">
            <div class="worker-info">
              <span class="worker-name">{{ worker.name }}</span>
              <span class="worker-status" :class="worker.status">{{ worker.status }}</span>
            </div>
            <div class="worker-actions">
              <button @click="editWorker(worker)" class="edit-btn">编辑</button>
              <button @click="deleteWorker(worker.id)" class="delete-btn">删除</button>
            </div>
          </div>
        </div>
        <button @click="addWorker" class="add-btn">➕ 添加Worker</button>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'

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

    const workers = ref([
      { id: 1, name: 'Worker-1', status: 'online' },
      { id: 2, name: 'Worker-2', status: 'offline' }
    ])

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

    const addWorker = () => {
      const name = prompt('请输入Worker名称:')
      if (name) {
        workers.value.push({
          id: Date.now(),
          name,
          status: 'offline'
        })
      }
    }

    const editWorker = (worker) => {
      const newName = prompt('请输入新的Worker名称:', worker.name)
      if (newName) {
        worker.name = newName
      }
    }

    const deleteWorker = (id) => {
      if (confirm('确定要删除这个Worker吗？')) {
        workers.value = workers.value.filter(w => w.id !== id)
      }
    }

    return {
      config,
      workers,
      saveBasicConfig,
      saveTelegramConfig,
      addWorker,
      editWorker,
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
}

.worker-name {
  font-weight: 500;
}

.worker-status {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  text-transform: uppercase;
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
</style>
