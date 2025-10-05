<template>
  <div class="change-password">
    <div class="change-password-container">
      <div class="change-password-card">
        <h2>🔐 修改密码</h2>
        
        <form @submit.prevent="changePassword" class="password-form">
          <div class="form-group">
            <label for="currentPassword">当前密码</label>
            <input
              id="currentPassword"
              v-model="form.currentPassword"
              type="password"
              placeholder="请输入当前密码"
              required
              autocomplete="current-password"
            />
          </div>
          
          <div class="form-group">
            <label for="newPassword">新密码</label>
            <input
              id="newPassword"
              v-model="form.newPassword"
              type="password"
              placeholder="请输入新密码（至少6位）"
              required
              minlength="6"
              autocomplete="new-password"
            />
          </div>
          
          <div class="form-group">
            <label for="confirmPassword">确认新密码</label>
            <input
              id="confirmPassword"
              v-model="form.confirmPassword"
              type="password"
              placeholder="请再次输入新密码"
              required
              minlength="6"
              autocomplete="new-password"
            />
          </div>
          
          <div class="password-tips">
            <h4>密码要求：</h4>
            <ul>
              <li>至少6位字符</li>
              <li>建议包含大小写字母、数字和特殊字符</li>
              <li>不要使用过于简单的密码</li>
            </ul>
          </div>
          
          <div class="form-actions">
            <button type="button" @click="goBack" class="cancel-btn">取消</button>
            <button type="submit" :disabled="loading" class="submit-btn">
              {{ loading ? '修改中...' : '修改密码' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { authFetch } from '../utils/api.js'

export default {
  name: 'ChangePassword',
  setup() {
    const router = useRouter()
    const loading = ref(false)
    
    const form = ref({
      currentPassword: '',
      newPassword: '',
      confirmPassword: ''
    })
    
    const showMessage = (message, type = 'info') => {
      const messageEl = document.createElement('div')
      messageEl.textContent = message
      messageEl.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#d4edda' : type === 'error' ? '#f8d7da' : '#d1ecf1'};
        color: ${type === 'success' ? '#155724' : type === 'error' ? '#721c24' : '#0c5460'};
        padding: 12px 20px;
        border-radius: 4px;
        border: 1px solid ${type === 'success' ? '#c3e6cb' : type === 'error' ? '#f5c6cb' : '#bee5eb'};
        z-index: 9999;
        font-size: 14px;
      `
      document.body.appendChild(messageEl)
      
      setTimeout(() => {
        if (document.body.contains(messageEl)) {
          document.body.removeChild(messageEl)
        }
      }, 3000)
    }
    
    const validateForm = () => {
      if (!form.value.currentPassword) {
        showMessage('请输入当前密码', 'error')
        return false
      }
      
      if (!form.value.newPassword) {
        showMessage('请输入新密码', 'error')
        return false
      }
      
      if (form.value.newPassword.length < 6) {
        showMessage('新密码长度至少6位', 'error')
        return false
      }
      
      if (form.value.newPassword !== form.value.confirmPassword) {
        showMessage('新密码与确认密码不匹配', 'error')
        return false
      }
      
      if (form.value.currentPassword === form.value.newPassword) {
        showMessage('新密码不能与当前密码相同', 'error')
        return false
      }
      
      return true
    }
    
    const changePassword = async () => {
      if (!validateForm()) {
        return
      }
      
      loading.value = true
      
      try {
        const response = await authFetch('/api/v1/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({
            current_password: form.value.currentPassword,
            new_password: form.value.newPassword,
            confirm_password: form.value.confirmPassword
          })
        })
        
        if (response.ok) {
          const result = await response.json()
          if (result.success) {
            showMessage('密码修改成功', 'success')
            // 清空表单
            form.value = {
              currentPassword: '',
              newPassword: '',
              confirmPassword: ''
            }
            // 延迟跳转
            setTimeout(() => {
              router.push('/')
            }, 2000)
          } else {
            showMessage(result.message || '密码修改失败', 'error')
          }
        } else {
          const errorResult = await response.json()
          showMessage(errorResult.detail || '密码修改失败', 'error')
        }
      } catch (error) {
        console.error('修改密码失败:', error)
        showMessage('修改密码失败', 'error')
      } finally {
        loading.value = false
      }
    }
    
    const goBack = () => {
      router.go(-1)
    }
    
    return {
      form,
      loading,
      changePassword,
      goBack
    }
  }
}
</script>

<style scoped>
.change-password {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.change-password-container {
  width: 100%;
  max-width: 500px;
}

.change-password-card {
  background: white;
  border-radius: 12px;
  padding: 40px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
}

.change-password-card h2 {
  text-align: center;
  margin-bottom: 30px;
  color: #333;
  font-size: 24px;
}

.password-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group label {
  font-weight: 500;
  color: #333;
  font-size: 14px;
}

.form-group input {
  padding: 12px 16px;
  border: 2px solid #e1e5e9;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 0.3s ease;
}

.form-group input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.password-tips {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: 16px;
  margin: 10px 0;
}

.password-tips h4 {
  margin: 0 0 8px 0;
  color: #495057;
  font-size: 14px;
}

.password-tips ul {
  margin: 0;
  padding-left: 20px;
  color: #6c757d;
  font-size: 13px;
}

.password-tips li {
  margin-bottom: 4px;
}

.form-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 20px;
}

.cancel-btn, .submit-btn {
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
}

.cancel-btn {
  background: #6c757d;
  color: white;
}

.cancel-btn:hover {
  background: #5a6268;
}

.submit-btn {
  background: #667eea;
  color: white;
}

.submit-btn:hover:not(:disabled) {
  background: #5a67d8;
  transform: translateY(-1px);
}

.submit-btn:disabled {
  background: #cbd5e0;
  cursor: not-allowed;
  transform: none;
}
</style>
