<template>
  <div class="login-container">
    <div class="login-card">
      <div class="login-header">
        <h2>🎯 DanDanPlay 数据交互中心</h2>
        <p>请登录以继续</p>
      </div>

      <form @submit.prevent="handleLogin" class="login-form">
        <div class="form-group">
          <label for="username">用户名</label>
          <input
            id="username"
            v-model="loginData.username"
            type="text"
            placeholder="请输入用户名"
            required
          />
        </div>

        <div class="form-group">
          <label for="password">密码</label>
          <input
            id="password"
            v-model="loginData.password"
            type="password"
            placeholder="请输入密码"
            required
            @keyup.enter="handleLogin"
          />
        </div>

        <button
          type="submit"
          class="login-btn"
          :disabled="loading"
        >
          {{ loading ? '登录中...' : '登录' }}
        </button>
      </form>

      <div class="login-footer">
        <p>💡 首次使用？查看启动日志获取初始密码</p>
        <p class="api-links">
          <a href="/docs" target="_blank">📖 API文档</a>
          <a href="/health" target="_blank">🔍 健康检查</a>
        </p>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { isLoggedIn } from '../utils/api.js'

export default {
  name: 'Login',
  setup() {
    const router = useRouter()
    const loading = ref(false)

    // 检查是否已登录
    onMounted(() => {
      if (isLoggedIn()) {
        // 如果已登录，重定向到主页
        router.push('/')
      }
    })

    const loginData = reactive({
      username: '',
      password: ''
    })

    const showMessage = (message, type = 'info') => {
      // 简单的消息提示
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

    const handleLogin = async () => {
      if (!loginData.username || !loginData.password) {
        showMessage('请填写用户名和密码', 'error')
        return
      }

      try {
        loading.value = true

        const response = await fetch('/api/v2/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(loginData)
        })

        if (response.ok) {
          const result = await response.json()
          // v2 统一响应：{ success, message, data: { access_token, token_type, user } }
          const payload = result.data || result
          if (payload.access_token) {
            // 保存JWT令牌
            localStorage.setItem('access_token', payload.access_token)
            localStorage.setItem('token_type', payload.token_type || 'bearer')
            showMessage(result.message || '登录成功', 'success')
            router.push('/')
          } else {
            showMessage(result.message || '登录失败', 'error')
          }
        } else {
          // 处理HTTP错误状态码
          try {
            const errorResult = await response.json()
            showMessage(errorResult.detail || errorResult.message || '登录失败', 'error')
          } catch {
            showMessage('登录失败', 'error')
          }
        }
      } catch (error) {
        console.error('登录错误:', error)
        showMessage('登录失败，请检查网络连接', 'error')
      } finally {
        loading.value = false
      }
    }

    return {
      loginData,
      loading,
      handleLogin
    }
  }
}
</script>

<style scoped>
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 20px;
}

.login-card {
  background: white;
  padding: 40px;
  border-radius: 16px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
  width: 100%;
  max-width: 400px;
}

.login-header {
  text-align: center;
  margin-bottom: 30px;
}

.login-header h2 {
  color: #333;
  margin-bottom: 8px;
  font-size: 24px;
}

.login-header p {
  color: #666;
  font-size: 14px;
}

.login-form {
  margin-bottom: 20px;
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

.form-group input {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 14px;
  transition: border-color 0.3s;
}

.form-group input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.1);
}

.login-btn {
  width: 100%;
  padding: 12px;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s;
}

.login-btn:hover:not(:disabled) {
  background: #5a67d8;
  transform: translateY(-1px);
}

.login-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
  transform: none;
}

.login-footer {
  text-align: center;
  margin-top: 20px;
}

.login-footer p {
  color: #999;
  font-size: 12px;
  margin: 8px 0;
}

.api-links {
  margin-top: 15px;
}

.api-links a {
  color: #667eea;
  text-decoration: none;
  margin: 0 10px;
  font-size: 12px;
}

.api-links a:hover {
  text-decoration: underline;
}
</style>
