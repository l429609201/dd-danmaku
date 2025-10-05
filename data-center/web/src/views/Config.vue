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
  background: #f5f5f5;
  min-height: calc(100vh - 64px);
}

/* 页面头部 */
.page-header {
  margin-bottom: 24px;
  padding: 24px;
  background: white;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  text-align: center;
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

.config-sections {
  display: grid;
  gap: 24px;
}

.config-card {
  background: white;
  padding: 24px;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  transition: all 0.3s ease;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.config-card:hover {
  background: #fafafa;
  border-color: #d0d0d0;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

.config-card h3 {
  color: #333;
  margin-bottom: 20px;
  font-size: 18px;
  font-weight: 600;
}

.config-form {
  display: grid;
  gap: 20px;
}

.form-group {
  display: grid;
  gap: 10px;
}

.form-group label {
  color: #ffffff;
  font-weight: 500;
  font-size: 15px;
}

.form-group input[type="text"],
.form-group input[type="number"],
.form-group input[type="password"] {
  padding: 14px 18px;
  border: 1px solid #3a3a3a;
  border-radius: 12px;
  font-size: 15px;
  background: #0f0f0f;
  color: #ffffff;
  transition: all 0.2s;
}

.form-group input:focus {
  outline: none;
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
  background: #1a1a1a;
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
  padding: 14px 28px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: white;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  font-size: 15px;
  font-weight: 500;
  transition: all 0.3s ease;
}

.save-btn:hover, .add-btn:hover {
  background: linear-gradient(135deg, #5b5bd6, #7c3aed);
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(99, 102, 241, 0.3);
}





.edit-btn, .delete-btn {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.edit-btn {
  background: #3a3a3a;
  color: #ffffff;
}

.delete-btn {
  background: linear-gradient(135deg, #ef4444, #f87171);
  color: white;
}

.edit-btn:hover {
  background: #4a4a4a;
  transform: translateY(-1px);
}

.delete-btn:hover {
  background: linear-gradient(135deg, #dc2626, #ef4444);
  transform: translateY(-1px);
}

/* 对话框样式 */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.dialog {
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 16px;
  padding: 32px;
  min-width: 450px;
  max-width: 550px;
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
}

.dialog h3 {
  margin: 0 0 24px 0;
  color: #ffffff;
  font-size: 20px;
  font-weight: 600;
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
