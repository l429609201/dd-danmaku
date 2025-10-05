<template>
  <div class="settings-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <h1>⚙️ 系统设置</h1>
      <p>管理系统配置和用户偏好设置</p>
    </div>

    <!-- 用户设置卡片 -->
    <div class="settings-card">
      <h3>👤 用户设置</h3>

      <div class="setting-item">
        <div>
          <div class="setting-label">用户名</div>
          <div class="setting-description">当前登录用户名</div>
        </div>
        <div class="setting-control">
          <span style="color: #a0a0a0;">{{ settings.username }}</span>
        </div>
      </div>

      <div class="setting-item">
        <div>
          <div class="setting-label">邮箱地址</div>
          <div class="setting-description">用于接收系统通知</div>
        </div>
        <div class="setting-control">
          <input v-model="settings.email" type="email" placeholder="请输入邮箱"
                 style="padding: 8px 12px; border: 1px solid #3a3a3a; border-radius: 6px; background: #0f0f0f; color: #ffffff;">
        </div>
      </div>

      <div class="setting-item">
        <div>
          <div class="setting-label">密码管理</div>
          <div class="setting-description">修改登录密码</div>
        </div>
        <div class="setting-control">
          <button class="btn btn-secondary" @click="changePassword">修改密码</button>
        </div>
      </div>

      <div class="setting-item">
        <div>
          <div class="setting-label">保存设置</div>
          <div class="setting-description">保存当前配置更改</div>
        </div>
        <div class="setting-control">
          <button class="btn btn-primary" @click="saveSettings">保存设置</button>
        </div>
      </div>
    </div>

    <!-- 系统设置卡片 -->
    <div class="settings-card" style="margin-top: 24px;">
      <h3>🔧 系统设置</h3>

      <div class="setting-item">
        <div>
          <div class="setting-label">自动刷新</div>
          <div class="setting-description">自动刷新统计数据</div>
        </div>
        <div class="setting-control">
          <input type="checkbox" v-model="settings.autoRefresh"
                 style="width: 18px; height: 18px;">
        </div>
      </div>

      <div class="setting-item">
        <div>
          <div class="setting-label">深色主题</div>
          <div class="setting-description">使用深色界面主题</div>
        </div>
        <div class="setting-control">
          <input type="checkbox" v-model="settings.darkTheme" checked disabled
                 style="width: 18px; height: 18px;">
        </div>
      </div>

      <div class="setting-item">
        <div>
          <div class="setting-label">日志级别</div>
          <div class="setting-description">系统日志记录级别</div>
        </div>
        <div class="setting-control">
          <select v-model="settings.logLevel"
                  style="padding: 8px 12px; border: 1px solid #3a3a3a; border-radius: 6px; background: #0f0f0f; color: #ffffff;">
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import { authFetch } from '../utils/api.js'

export default {
  name: 'Settings',
  setup() {
    const settings = ref({
      username: '',
      email: '',
      autoRefresh: true,
      darkTheme: true,
      logLevel: 'info'
    })

    const loadUserInfo = async () => {
      try {
        const response = await authFetch('/api/v1/auth/me')
        if (response.ok) {
          const userInfo = await response.json()
          settings.value.username = userInfo.username || ''
          settings.value.email = userInfo.email || ''
        }
      } catch (error) {
        console.error('获取用户信息失败:', error)
      }
    }

    const saveSettings = async () => {
      try {
        // 这里可以添加保存设置的API调用
        alert('设置已保存')
      } catch (error) {
        console.error('保存设置失败:', error)
        alert('保存设置失败')
      }
    }

    const changePassword = () => {
      // 这里可以添加修改密码的逻辑
      alert('修改密码功能')
    }

    onMounted(() => {
      loadUserInfo()
    })

    return {
      settings,
      saveSettings,
      changePassword
    }
  }
}
</script>

<style scoped>
.settings-page {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
  background: #f5f5f5;
  min-height: calc(100vh - 64px);
}

.page-header {
  margin-bottom: 24px;
  padding: 24px;
  background: white;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.page-header h1 {
  color: #333;
  margin-bottom: 8px;
  font-size: 28px;
  font-weight: 600;
}

.page-header p {
  color: #666;
  font-size: 16px;
  margin: 0;
}

.settings-card {
  background: white;
  padding: 24px;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  transition: all 0.3s ease;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.settings-card:hover {
  background: #fafafa;
  border-color: #d0d0d0;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

.settings-card h3 {
  color: #333;
  margin-bottom: 20px;
  font-size: 18px;
  font-weight: 600;
}

.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 0;
  border-bottom: 1px solid #2a2a2a;
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-label {
  color: #ffffff;
  font-size: 15px;
  font-weight: 500;
}

.setting-description {
  color: #a0a0a0;
  font-size: 13px;
  margin-top: 4px;
}

.setting-control {
  display: flex;
  align-items: center;
  gap: 12px;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.3s ease;
}

.btn-primary {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: white;
}

.btn-primary:hover {
  background: linear-gradient(135deg, #5b5bd6, #7c3aed);
  transform: translateY(-1px);
}

.btn-secondary {
  background: #3a3a3a;
  color: white;
}

.btn-secondary:hover {
  background: #4a4a4a;
  transform: translateY(-1px);
}
</style>
