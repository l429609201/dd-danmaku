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
        <div class="card-header">
          <h3>🤖 Telegram机器人</h3>
          <div class="header-buttons">
            <button @click="restartTelegramBot" class="btn btn-warning">🔄 重启机器人</button>
            <button @click="createBotMenu" class="btn btn-secondary">📋 创建机器人菜单</button>
          </div>
        </div>
        <div class="card-body">
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
        showMessage('正在保存基本配置...', 'info')

        const response = await authFetch('/api/web-config/system-settings', {
          method: 'PUT',
          body: JSON.stringify({
            project_name: config.value.systemName,
            log_level: config.value.debugMode ? 'DEBUG' : 'INFO'
          })
        })

        if (response.ok) {
          const result = await response.json()
          if (result.success) {
            showMessage('基本配置保存成功', 'success')
          } else {
            showMessage(`保存失败: ${result.message}`, 'error')
          }
        } else {
          showMessage(`保存失败: HTTP ${response.status}`, 'error')
        }
      } catch (error) {
        showMessage(`保存失败: ${error.message}`, 'error')
      }
    }

    const saveTelegramConfig = async () => {
      try {
        showMessage('正在保存Telegram配置...', 'info')

        const response = await authFetch('/api/web-config/system-settings', {
          method: 'PUT',
          body: JSON.stringify({
            tg_bot_token: config.value.telegramToken,
            tg_admin_user_ids: config.value.adminUserIds
          })
        })

        if (response.ok) {
          const result = await response.json()
          if (result.success) {
            showMessage('Telegram配置保存成功！需要重启服务才能生效', 'success')
          } else {
            showMessage(`保存失败: ${result.message}`, 'error')
          }
        } else {
          showMessage(`保存失败: HTTP ${response.status}`, 'error')
        }
      } catch (error) {
        showMessage(`保存失败: ${error.message}`, 'error')
      }
    }

    const restartTelegramBot = async () => {
      try {
        showMessage('正在重启Telegram机器人...', 'info')

        const response = await authFetch('/api/telegram/restart', {
          method: 'POST'
        })

        if (response.ok) {
          const result = await response.json()
          if (result.success) {
            showMessage('Telegram机器人重启成功', 'success')
          } else {
            showMessage(`重启失败: ${result.message}`, 'error')
          }
        } else {
          showMessage(`重启失败: HTTP ${response.status}`, 'error')
        }
      } catch (error) {
        showMessage(`重启失败: ${error.message}`, 'error')
      }
    }

    const createBotMenu = async () => {
      if (!config.value.telegramToken) {
        showMessage('请先配置Bot Token', 'error')
        return
      }

      try {
        showMessage('正在创建机器人菜单...', 'info')

        const response = await authFetch('/api/telegram/create-menu', {
          method: 'POST',
          body: JSON.stringify({
            bot_token: config.value.telegramToken
          })
        })

        if (response.ok) {
          const result = await response.json()
          if (result.success) {
            showMessage('机器人菜单创建成功！', 'success')
          } else {
            showMessage(`创建失败: ${result.message}`, 'error')
          }
        } else {
          const errorText = await response.text()
          showMessage(`创建失败: HTTP ${response.status} - ${errorText}`, 'error')
        }
      } catch (error) {
        showMessage(`创建异常: ${error.message}`, 'error')
      }
    }









    // 加载配置数据
    const loadConfigs = async () => {
      try {
        // 加载系统设置（包括TG机器人配置）- 使用with-secrets端点获取完整数据
        const systemResponse = await authFetch('/api/web-config/system-settings/with-secrets')
        if (systemResponse.ok) {
          const systemData = await systemResponse.json()
          console.log('加载的系统配置:', systemData)
          if (systemData) {
            config.value.systemName = systemData.project_name || config.value.systemName
            config.value.debugMode = systemData.log_level === 'DEBUG'
            config.value.telegramToken = systemData.tg_bot_token || ''
            config.value.adminUserIds = systemData.tg_admin_user_ids || ''
            console.log('TG Token长度:', config.value.telegramToken.length)
            console.log('Admin User IDs:', config.value.adminUserIds)
          }
        }
      } catch (error) {
        console.error('加载配置失败:', error)
      }
    }

    onMounted(() => {
      loadConfigs()
    })



    return {
      config,
      saveBasicConfig,
      saveTelegramConfig,
      restartTelegramBot,
      createBotMenu
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
  color: #333;
  font-weight: 500;
  font-size: 15px;
}

.form-group input[type="text"],
.form-group input[type="number"],
.form-group input[type="password"] {
  padding: 12px 16px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  background: white;
  color: #333;
  transition: all 0.2s;
  box-sizing: border-box;
}

.form-group input:focus {
  outline: none;
  border-color: #1976d2;
  box-shadow: 0 0 0 3px rgba(25, 118, 210, 0.1);
  background: #fafafa;
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
  padding: 10px 20px;
  background: #1976d2;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.3s ease;
}

.save-btn:hover, .add-btn:hover {
  background: #1565c0;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(25, 118, 210, 0.3);
}





.edit-btn, .delete-btn {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.edit-btn {
  background: #f5f5f5;
  color: #333;
  border: 1px solid #ddd;
}

.delete-btn {
  background: #f44336;
  color: white;
}

.edit-btn:hover {
  background: #e0e0e0;
  border-color: #ccc;
}

.delete-btn:hover {
  background: #d32f2f;
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
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 24px;
  min-width: 400px;
  max-width: 500px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.dialog h3 {
  margin: 0 0 24px 0;
  color: #333;
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

/* 新增样式 */
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.header-buttons {
  display: flex;
  gap: 8px;
}

.card-header h3 {
  margin: 0;
  color: #333;
  font-size: 18px;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.3s ease;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.btn-primary {
  background: #1976d2;
  color: white;
}

.btn-primary:hover {
  background: #1565c0;
  transform: translateY(-1px);
}

.btn-secondary {
  background: #f5f5f5;
  color: #333;
  border: 1px solid #ddd;
}

.btn-secondary:hover {
  background: #e0e0e0;
}

.btn-danger {
  background: #f44336;
  color: white;
  padding: 6px 12px;
  font-size: 12px;
}

.btn-danger:hover {
  background: #d32f2f;
}

.empty-state {
  text-align: center;
  color: #666;
  padding: 40px 20px;
  background: #f9f9f9;
  border-radius: 6px;
  margin-bottom: 20px;
}

.ua-config-item,
.ip-blacklist-item {
  background: #f9f9f9;
  padding: 20px;
  border-radius: 6px;
  margin-bottom: 16px;
  border: 1px solid #e0e0e0;
}

.form-row {
  display: flex;
  gap: 16px;
  align-items: end;
}

.form-row .form-group {
  flex: 1;
}

.form-row .btn-danger {
  flex-shrink: 0;
  margin-bottom: 0;
}

/* UA配置特殊样式 */
.ua-config-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #e0e0e0;
}

.ua-config-header h4 {
  margin: 0;
  color: #333;
  font-size: 16px;
}

.btn-sm {
  padding: 4px 8px;
  font-size: 12px;
}

.path-limits-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.section-header label {
  margin: 0;
  font-weight: 600;
  color: #333;
}

.empty-state-small {
  text-align: center;
  color: #999;
  padding: 20px;
  background: #fafafa;
  border-radius: 4px;
  font-size: 13px;
}

.path-limit-item {
  background: #fafafa;
  padding: 12px;
  border-radius: 4px;
  margin-bottom: 8px;
  border: 1px solid #f0f0f0;
}

/* 模态框样式 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  border-radius: 8px;
  padding: 0;
  max-width: 600px;
  width: 90%;
  max-height: 80vh;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid #e0e0e0;
  background: #f8f9fa;
}

.modal-header h3 {
  margin: 0;
  color: #333;
}

.modal-body {
  padding: 20px;
  max-height: 60vh;
  overflow-y: auto;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 20px;
  border-top: 1px solid #e0e0e0;
  background: #f8f9fa;
}

.json-textarea {
  width: 100%;
  min-height: 400px;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-family: 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.6;
  resize: vertical;
  background: #f8f9fa;
}

.json-textarea:focus {
  outline: none;
  border-color: #1976d2;
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.2);
  background: white;
}

.validation-error {
  margin-top: 12px;
  padding: 12px;
  background: #ffebee;
  border: 1px solid #f44336;
  border-radius: 6px;
  color: #c62828;
  font-size: 14px;
}

.validation-success {
  margin-top: 12px;
  padding: 12px;
  background: #e8f5e9;
  border: 1px solid #4caf50;
  border-radius: 6px;
  color: #2e7d32;
  font-size: 14px;
}

.modal-content.large {
  max-width: 900px;
}



.current-key-info h4 {
  margin: 0 0 12px 0;
  color: #333;
  font-size: 14px;
  font-weight: 600;
}

.key-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
}

.key-info .label {
  font-weight: 500;
  color: #666;
}

.key-info .value {
  color: #333;
  font-family: monospace;
  font-size: 14px;
}

.help-text {
  color: #666;
  font-size: 12px;
  margin-top: 4px;
  display: block;
}

</style>
