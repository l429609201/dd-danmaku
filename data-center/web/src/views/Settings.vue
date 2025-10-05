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
                 style="padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; background: white; color: #333;">
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
                  style="padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; background: white; color: #333;">
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>
        </div>
      </div>
    </div>

    <!-- 修改密码弹窗 -->
    <div v-if="showPasswordModal" class="modal-overlay" @click="closePasswordModal">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3>🔐 修改密码</h3>
          <button class="modal-close" @click="closePasswordModal">✕</button>
        </div>

        <form @submit.prevent="submitPasswordChange" class="modal-body">
          <div class="form-group">
            <label>当前密码</label>
            <input
              v-model="passwordForm.currentPassword"
              type="password"
              placeholder="请输入当前密码"
              required
              class="form-input"
            />
          </div>

          <div class="form-group">
            <label>新密码</label>
            <input
              v-model="passwordForm.newPassword"
              type="password"
              placeholder="请输入新密码（至少6位）"
              required
              minlength="6"
              class="form-input"
            />
          </div>

          <div class="form-group">
            <label>确认新密码</label>
            <input
              v-model="passwordForm.confirmPassword"
              type="password"
              placeholder="请再次输入新密码"
              required
              minlength="6"
              class="form-input"
            />
          </div>

          <div class="password-tips">
            <p>密码要求：至少6位字符，建议包含大小写字母、数字和特殊字符</p>
          </div>

          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="closePasswordModal">取消</button>
            <button type="submit" class="btn btn-primary" :disabled="passwordLoading">
              {{ passwordLoading ? '修改中...' : '确认修改' }}
            </button>
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
  name: 'Settings',
  setup() {
    const settings = ref({
      username: '',
      email: '',
      autoRefresh: true,
      darkTheme: true,
      logLevel: 'info'
    })

    // 密码修改弹窗相关
    const showPasswordModal = ref(false)
    const passwordLoading = ref(false)
    const passwordForm = ref({
      currentPassword: '',
      newPassword: '',
      confirmPassword: ''
    })

    const loadUserInfo = async () => {
      try {
        const response = await authFetch('/auth/me')
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

    // 密码修改方法
    const changePassword = () => {
      showPasswordModal.value = true
    }

    const closePasswordModal = () => {
      showPasswordModal.value = false
      passwordForm.value = {
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      }
    }

    const submitPasswordChange = async () => {
      if (passwordForm.value.newPassword !== passwordForm.value.confirmPassword) {
        alert('新密码和确认密码不匹配')
        return
      }

      if (passwordForm.value.newPassword.length < 6) {
        alert('新密码至少需要6位字符')
        return
      }

      passwordLoading.value = true

      try {
        const response = await authFetch('/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({
            current_password: passwordForm.value.currentPassword,
            new_password: passwordForm.value.newPassword
          })
        })

        if (response.ok) {
          alert('密码修改成功，请重新登录')
          closePasswordModal()
          // 可以选择自动登出
          localStorage.removeItem('access_token')
          localStorage.removeItem('token_type')
          window.location.href = '/'
        } else {
          const error = await response.json()
          alert(error.message || '密码修改失败')
        }
      } catch (error) {
        console.error('密码修改失败:', error)
        alert('密码修改失败')
      } finally {
        passwordLoading.value = false
      }
    }

    onMounted(() => {
      loadUserInfo()
    })

    return {
      settings,
      showPasswordModal,
      passwordLoading,
      passwordForm,
      saveSettings,
      changePassword,
      closePasswordModal,
      submitPasswordChange
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
  border-bottom: 1px solid #e0e0e0;
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-label {
  color: #333;
  font-size: 15px;
  font-weight: 500;
}

.setting-description {
  color: #666;
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
  transform: translateY(-1px);
}

/* 弹窗样式 */
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
}

.modal-content {
  background: white;
  border-radius: 8px;
  width: 90%;
  max-width: 500px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid #e0e0e0;
}

.modal-header h3 {
  margin: 0;
  color: #333;
  font-size: 18px;
}

.modal-close {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #666;
  padding: 4px;
  border-radius: 4px;
}

.modal-close:hover {
  background: #f5f5f5;
  color: #333;
}

.modal-body {
  padding: 24px;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  color: #333;
  font-weight: 500;
}

.form-input {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  transition: border-color 0.3s ease;
  box-sizing: border-box;
}

.form-input:focus {
  outline: none;
  border-color: #1976d2;
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.1);
}

.password-tips {
  background: #f9f9f9;
  padding: 12px 16px;
  border-radius: 6px;
  margin-bottom: 20px;
}

.password-tips p {
  margin: 0;
  color: #666;
  font-size: 13px;
}

.modal-footer {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 24px;
}

.modal-footer .btn {
  padding: 10px 20px;
}
</style>
