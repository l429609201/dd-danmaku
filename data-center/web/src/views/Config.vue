<template>
  <div class="config-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-content">
        <h1>⚙️ 配置管理</h1>
        <p>管理系统基础配置和服务设置</p>
      </div>
    </div>

    <div class="config-sections">
      <!-- 基本配置卡片 -->
      <div class="config-card">
        <div class="card-header">
          <h3>🔧 基本配置</h3>
        </div>
        <div class="card-body">
          <form @submit.prevent="saveBasicConfig" class="config-form">
            <div class="form-group">
              <label>系统名称</label>
              <input v-model="config.systemName" type="text" placeholder="DanDanPlay API 数据交互中心" class="form-input" />
            </div>
            <div class="form-group">
              <label>API端口</label>
              <input v-model.number="config.apiPort" type="number" min="1000" max="65535" placeholder="7759" class="form-input" />
            </div>
            <div class="form-group">
              <label class="checkbox-wrapper">
                <input v-model="config.debugMode" type="checkbox" class="checkbox-input" />
                <span class="checkbox-custom"></span>
                <span class="checkbox-label">启用调试日志</span>
              </label>
            </div>
            <button type="submit" class="btn btn-primary">💾 保存基本配置</button>
          </form>
        </div>
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

    onMounted(() => {
      // 页面加载时的初始化
    })

    return {
      config,
      saveBasicConfig,
      saveTelegramConfig
    }
  }
}
</script>

<style scoped>
.config-page {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
  background: #f8fafc;
  min-height: 100vh;
}

/* 页面头部 */
.page-header {
  margin-bottom: 32px;
  padding: 24px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  text-align: center;
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
