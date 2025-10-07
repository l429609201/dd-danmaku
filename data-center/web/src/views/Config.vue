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

      <!-- API密钥管理 -->
      <div class="config-card">
        <div class="card-header">
          <h3>🔑 API密钥管理</h3>
          <button @click="generateApiKey" class="btn btn-primary">🎲 生成新密钥</button>
        </div>
        <div class="card-body">
          <div class="form-group">
            <label>数据中心API密钥</label>
            <div class="api-key-input">
              <input
                v-model="apiKeyConfig.dataCenterApiKey"
                type="password"
                placeholder="请输入或生成API密钥"
                :readonly="apiKeyConfig.isReadonly"
              />
              <button @click="toggleApiKeyVisibility" class="btn btn-outline">
                {{ apiKeyConfig.showKey ? '🙈' : '👁️' }}
              </button>
            </div>
            <small class="help-text">
              此密钥用于Worker与数据中心之间的双向认证通信
            </small>
          </div>

          <div v-if="apiKeyConfig.currentKey" class="current-key-info">
            <h4>当前密钥信息</h4>
            <div class="key-info">
              <span class="label">密钥（脱敏）:</span>
              <span class="value">{{ apiKeyConfig.currentKey.masked }}</span>
            </div>
            <div class="key-info">
              <span class="label">密钥长度:</span>
              <span class="value">{{ apiKeyConfig.currentKey.length }} 字符</span>
            </div>
          </div>

          <button @click="saveApiKey" class="save-btn" :disabled="!apiKeyConfig.dataCenterApiKey">
            🔑 保存API密钥
          </button>
        </div>
      </div>

      <div class="config-card">
        <div class="card-header">
          <h3>🤖 Telegram机器人</h3>
          <button @click="createBotMenu" class="btn btn-secondary">📋 创建机器人菜单</button>
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

      <!-- UA配置卡片 -->
      <div class="config-card">
        <div class="card-header">
          <h3>🌐 User Agent 配置</h3>
          <div class="header-buttons">
            <button @click="showImportDialog" class="btn btn-secondary">📥 JSON导入</button>
            <button @click="addUAConfig" class="btn btn-secondary">➕ 添加UA配置</button>
          </div>
        </div>
        <div class="card-body">
          <div v-if="uaConfigs.length === 0" class="empty-state">
            暂无UA配置，点击上方按钮添加
          </div>
          <div v-for="(ua, index) in uaConfigs" :key="index" class="ua-config-item">
            <div class="ua-config-header">
              <h4>{{ ua.name || `配置 ${index + 1}` }}</h4>
              <button @click="removeUAConfig(index)" class="btn btn-danger btn-sm">🗑️ 删除</button>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>配置名称</label>
                <input v-model="ua.name" type="text" placeholder="例如: MisakaDanmaku" class="form-input" />
              </div>
              <div class="form-group">
                <label>User Agent</label>
                <input v-model="ua.userAgent" type="text" placeholder="例如: misaka10876/v1.0.0" class="form-input" />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>每小时限制</label>
                <input v-model.number="ua.maxRequestsPerHour" type="number" min="-1" placeholder="100 (-1表示无限制)" class="form-input" />
              </div>
              <div class="form-group">
                <label>每日限制</label>
                <input v-model.number="ua.maxRequestsPerDay" type="number" min="-1" placeholder="1000 (-1表示无限制)" class="form-input" />
              </div>
            </div>

            <div class="form-group">
              <label>描述</label>
              <input v-model="ua.description" type="text" placeholder="例如: Misaka弹幕专用客户端" class="form-input" />
            </div>

            <div class="form-group">
              <label class="checkbox-wrapper">
                <input v-model="ua.enabled" type="checkbox" class="checkbox-input" />
                <span class="checkbox-custom"></span>
                <span class="checkbox-label">启用此配置</span>
              </label>
            </div>

            <!-- 路径限制配置 -->
            <div class="path-limits-section">
              <div class="section-header">
                <label>路径限制</label>
                <button @click="addPathLimit(index)" type="button" class="btn btn-secondary btn-sm">➕ 添加路径限制</button>
              </div>

              <div v-if="ua.pathLimits && ua.pathLimits.length === 0" class="empty-state-small">
                暂无路径限制
              </div>

              <div v-for="(pathLimit, pathIndex) in ua.pathLimits" :key="pathIndex" class="path-limit-item">
                <div class="form-row">
                  <div class="form-group">
                    <label>路径</label>
                    <input v-model="pathLimit.path" type="text" placeholder="例如: /api/v2/comment/" class="form-input" />
                  </div>
                  <div class="form-group">
                    <label>每小时限制</label>
                    <input v-model.number="pathLimit.maxRequestsPerHour" type="number" min="1" placeholder="50" class="form-input" />
                  </div>
                  <button @click="removePathLimit(index, pathIndex)" class="btn btn-danger btn-sm">🗑️</button>
                </div>
              </div>
            </div>
          </div>
          <button @click="saveUAConfigs" class="btn btn-primary">💾 保存UA配置</button>
        </div>
      </div>

      <!-- IP黑名单配置卡片 -->
      <div class="config-card">
        <div class="card-header">
          <h3>🚫 IP黑名单配置</h3>
          <button @click="addIPBlacklist" class="btn btn-secondary">➕ 添加IP</button>
        </div>
        <div class="card-body">
          <div v-if="ipBlacklist.length === 0" class="empty-state">
            暂无IP黑名单，点击上方按钮添加
          </div>
          <div v-for="(ip, index) in ipBlacklist" :key="index" class="ip-blacklist-item">
            <div class="form-row">
              <div class="form-group">
                <label>IP地址/CIDR</label>
                <input v-model="ipBlacklist[index]" type="text" placeholder="例如: 192.168.1.1 或 192.168.1.0/24" class="form-input" />
              </div>
              <button @click="removeIPBlacklist(index)" class="btn btn-danger">🗑️</button>
            </div>
          </div>
          <button @click="saveIPBlacklist" class="btn btn-primary">💾 保存IP黑名单</button>
        </div>
      </div>
    </div>

    <!-- JSON导入对话框 -->
    <div v-if="showImportModal" class="modal-overlay" @click="closeImportDialog">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3>📥 导入UA配置JSON</h3>
          <button @click="closeImportDialog" class="btn btn-secondary">✖️</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>请粘贴JSON配置：</label>
            <textarea
              v-model="importJsonText"
              placeholder="请粘贴JSON配置..."
              class="json-textarea"
              rows="15"
            ></textarea>
          </div>
          <div class="import-options">
            <label class="checkbox-label">
              <input type="checkbox" v-model="replaceExisting" />
              替换现有配置（否则追加到现有配置）
            </label>
          </div>
        </div>
        <div class="modal-footer">
          <button @click="closeImportDialog" class="btn btn-secondary">取消</button>
          <button @click="importUAConfigs" class="btn btn-primary">导入配置</button>
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

    const uaConfigs = ref([])
    const ipBlacklist = ref([])

    // API密钥配置
    const apiKeyConfig = ref({
      dataCenterApiKey: '',
      showKey: false,
      isReadonly: false,
      currentKey: null
    })

    // JSON导入相关
    const showImportModal = ref(false)
    const importJsonText = ref('')
    const replaceExisting = ref(false)





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







    // IP黑名单方法
    const addIPBlacklist = () => {
      ipBlacklist.value.push('')
    }

    const removeIPBlacklist = (index) => {
      ipBlacklist.value.splice(index, 1)
    }

    const saveIPBlacklist = async () => {
      try {
        const response = await authFetch('/api/web-config/ip-blacklist', {
          method: 'POST',
          body: JSON.stringify(ipBlacklist.value)
        })

        if (response.ok) {
          const result = await response.json()
          if (result.success) {
            showMessage('IP黑名单保存成功', 'success')
          } else {
            showMessage(`IP黑名单保存失败: ${result.message}`, 'error')
          }
        } else {
          const errorText = await response.text()
          showMessage(`IP黑名单保存失败: HTTP ${response.status} - ${errorText}`, 'error')
        }
      } catch (error) {
        showMessage(`IP黑名单保存异常: ${error.message}`, 'error')
      }
    }

    // 加载配置数据
    const loadConfigs = async () => {
      try {
        // 加载系统设置（包括TG机器人配置）
        const systemResponse = await authFetch('/api/web-config/system-settings')
        if (systemResponse.ok) {
          const systemData = await systemResponse.json()
          if (systemData) {
            config.value.systemName = systemData.system_name || config.value.systemName
            config.value.apiPort = systemData.api_port || config.value.apiPort
            config.value.debugMode = systemData.debug_mode || config.value.debugMode
            config.value.telegramToken = systemData.tg_bot_token || ''
            config.value.adminUserIds = systemData.tg_admin_user_ids || ''
          }
        }

        // 加载UA配置
        const uaResponse = await authFetch('/api/web-config/ua-configs')
        if (uaResponse.ok) {
          const uaData = await uaResponse.json()
          uaConfigs.value = uaData || []
        }

        // 加载IP黑名单
        const ipResponse = await authFetch('/api/web-config/ip-blacklist')
        if (ipResponse.ok) {
          const ipData = await ipResponse.json()
          ipBlacklist.value = ipData || []
        }
      } catch (error) {
        console.error('加载配置失败:', error)
      }
    }

    onMounted(() => {
      loadConfigs()
      loadCurrentApiKey()
    })

    // UA配置方法
    const addUAConfig = () => {
      uaConfigs.value.push({
        name: '',
        enabled: true,
        userAgent: '',
        maxRequestsPerHour: 100,
        maxRequestsPerDay: 1000,
        description: '',
        pathLimits: []
      })
    }

    const removeUAConfig = (index) => {
      uaConfigs.value.splice(index, 1)
    }

    const addPathLimit = (uaIndex) => {
      if (!uaConfigs.value[uaIndex].pathLimits) {
        uaConfigs.value[uaIndex].pathLimits = []
      }
      uaConfigs.value[uaIndex].pathLimits.push({
        path: '',
        maxRequestsPerHour: 50
      })
    }

    const removePathLimit = (uaIndex, pathIndex) => {
      uaConfigs.value[uaIndex].pathLimits.splice(pathIndex, 1)
    }

    // JSON导入方法
    const showImportDialog = () => {
      showImportModal.value = true
      importJsonText.value = ''
      replaceExisting.value = false
    }

    const closeImportDialog = () => {
      showImportModal.value = false
      importJsonText.value = ''
      replaceExisting.value = false
    }

    const importUAConfigs = () => {
      try {
        if (!importJsonText.value.trim()) {
          showMessage('请输入JSON配置', 'error')
          return
        }

        const jsonData = JSON.parse(importJsonText.value)
        const importedConfigs = []

        // 转换JSON格式到内部格式
        for (const [name, config] of Object.entries(jsonData)) {
          const uaConfig = {
            name: name,
            enabled: config.enabled || true,
            userAgent: config.userAgent || '',
            maxRequestsPerHour: config.maxRequestsPerHour || 100,
            maxRequestsPerDay: config.maxRequestsPerDay || 1000,
            description: config.description || '',
            pathLimits: []
          }

          // 转换pathLimits格式
          if (config.pathLimits && Array.isArray(config.pathLimits)) {
            uaConfig.pathLimits = config.pathLimits.map(limit => ({
              path: limit.path || '',
              maxRequestsPerHour: limit.maxRequestsPerHour || 50
            }))
          }

          importedConfigs.push(uaConfig)
        }

        // 根据选项决定是替换还是追加
        if (replaceExisting.value) {
          uaConfigs.value = importedConfigs
          showMessage(`成功导入 ${importedConfigs.length} 个UA配置（已替换现有配置）`, 'success')
        } else {
          uaConfigs.value.push(...importedConfigs)
          showMessage(`成功导入 ${importedConfigs.length} 个UA配置（已追加到现有配置）`, 'success')
        }

        closeImportDialog()
      } catch (error) {
        showMessage(`JSON解析失败: ${error.message}`, 'error')
      }
    }

    const saveUAConfigs = async () => {
      try {
        const response = await authFetch('/api/web-config/ua-configs', {
          method: 'POST',
          body: JSON.stringify(uaConfigs.value)
        })

        if (response.ok) {
          const result = await response.json()
          if (result.success) {
            showMessage('UA配置保存成功', 'success')
          } else {
            showMessage(`UA配置保存失败: ${result.message}`, 'error')
          }
        } else {
          const errorText = await response.text()
          showMessage(`UA配置保存失败: HTTP ${response.status} - ${errorText}`, 'error')
        }
      } catch (error) {
        showMessage(`UA配置保存异常: ${error.message}`, 'error')
      }
    }



    // API密钥管理方法
    const generateApiKey = async () => {
      try {
        const response = await authFetch('/api/system-config/generate-api-key', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ length: 32 })
        })

        if (response.ok) {
          const result = await response.json()
          apiKeyConfig.value.dataCenterApiKey = result.api_key
          showMessage('API密钥生成成功', 'success')
        } else {
          showMessage('API密钥生成失败', 'error')
        }
      } catch (error) {
        showMessage(`API密钥生成异常: ${error.message}`, 'error')
      }
    }

    const saveApiKey = async () => {
      if (!apiKeyConfig.value.dataCenterApiKey) {
        showMessage('请输入API密钥', 'error')
        return
      }

      try {
        const response = await authFetch('/api/system-config/set-data-center-api-key', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ api_key: apiKeyConfig.value.dataCenterApiKey })
        })

        if (response.ok) {
          showMessage('API密钥保存成功', 'success')
          await loadCurrentApiKey()
        } else {
          showMessage('API密钥保存失败', 'error')
        }
      } catch (error) {
        showMessage(`API密钥保存异常: ${error.message}`, 'error')
      }
    }

    const loadCurrentApiKey = async () => {
      try {
        const response = await authFetch('/api/system-config/data-center-api-key')
        if (response.ok) {
          const result = await response.json()
          apiKeyConfig.value.currentKey = {
            masked: result.api_key_masked,
            length: result.key_length,
            hasKey: result.has_key
          }
        }
      } catch (error) {
        console.error('加载当前API密钥失败:', error)
      }
    }

    const toggleApiKeyVisibility = () => {
      apiKeyConfig.value.showKey = !apiKeyConfig.value.showKey
      const input = document.querySelector('.api-key-input input')
      if (input) {
        input.type = apiKeyConfig.value.showKey ? 'text' : 'password'
      }
    }

    return {
      config,
      uaConfigs,
      ipBlacklist,
      apiKeyConfig,
      showImportModal,
      importJsonText,
      replaceExisting,
      saveBasicConfig,
      saveTelegramConfig,
      createBotMenu,
      generateApiKey,
      saveApiKey,
      loadCurrentApiKey,
      toggleApiKeyVisibility,
      addUAConfig,
      removeUAConfig,
      addPathLimit,
      removePathLimit,
      saveUAConfigs,
      showImportDialog,
      closeImportDialog,
      importUAConfigs,
      addIPBlacklist,
      removeIPBlacklist,
      saveIPBlacklist
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
  min-height: 300px;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-family: 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.4;
  resize: vertical;
}

.json-textarea:focus {
  outline: none;
  border-color: #1976d2;
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.2);
}

.import-options {
  margin-top: 16px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
}

.checkbox-label input[type="checkbox"] {
  margin: 0;
}

/* API密钥管理样式 */
.api-key-input {
  display: flex;
  gap: 8px;
  align-items: center;
}

.api-key-input input {
  flex: 1;
}

.current-key-info {
  margin-top: 16px;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 6px;
  border: 1px solid #e9ecef;
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
