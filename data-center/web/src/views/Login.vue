<template>
  <main class="login-page">
    <div class="login-shell">
      <section class="brand-panel" aria-labelledby="brand-title">
        <div class="brand-lockup">
          <span class="brand-name">弹幕数据交互中心</span>
        </div>
        <div class="brand-copy">
          <p class="eyebrow">DATA CENTER</p>
          <h1 id="brand-title">数据交互中心</h1>
          <p class="brand-description">集中管理弹幕数据、媒体资源与服务配置。</p>
        </div>
        <p class="brand-note">管理访问 · 请使用已授权的账号登录</p>
      </section>

      <section class="login-card" aria-labelledby="login-title">
        <header class="login-header">
          <p class="eyebrow">账号登录</p>
          <h2 id="login-title">欢迎回来</h2>
          <p id="login-description">登录以进入数据交互中心。</p>
        </header>

        <!-- 统一通过表单提交，避免 Enter 与按钮触发两次请求。 -->
        <form
          class="login-form"
          novalidate
          aria-describedby="login-description"
          :aria-busy="loading"
          @submit.prevent="handleLogin"
        >
          <div class="form-group">
            <label for="username">用户名</label>
            <input
              id="username"
              ref="usernameInput"
              v-model="loginData.username"
              name="username"
              type="text"
              autocomplete="username"
              autocapitalize="none"
              :spellcheck="false"
              placeholder="请输入用户名"
              required
              :readonly="loading"
              :aria-invalid="Boolean(fieldErrors.username)"
              :aria-describedby="fieldErrors.username ? 'username-error' : undefined"
              @input="fieldErrors.username = ''; errorMessage = ''"
            />
            <p v-if="fieldErrors.username" id="username-error" class="field-error">
              {{ fieldErrors.username }}
            </p>
          </div>

          <div class="form-group">
            <label for="password">密码</label>
            <div class="password-field">
              <input
                id="password"
                ref="passwordInput"
                v-model="loginData.password"
                name="password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                placeholder="请输入密码"
                required
                :readonly="loading"
                :aria-invalid="Boolean(fieldErrors.password)"
                :aria-describedby="fieldErrors.password ? 'password-error' : undefined"
                @input="fieldErrors.password = ''; errorMessage = ''"
              />
              <button
                type="button"
                class="password-toggle"
                aria-controls="password"
                :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                :aria-pressed="showPassword"
                @click="showPassword = !showPassword"
              >
                {{ showPassword ? '隐藏' : '显示' }}
              </button>
            </div>
            <p v-if="fieldErrors.password" id="password-error" class="field-error">
              {{ fieldErrors.password }}
            </p>
          </div>

          <!-- 保留错误区域的实时播报能力，错误不再依赖短暂的浮层提示。 -->
          <div class="login-feedback" role="alert" aria-atomic="true">
            <p v-if="errorMessage" class="login-error">{{ errorMessage }}</p>
          </div>
          <button type="submit" class="login-button" :disabled="loading">
            <span v-if="loading" class="loading-indicator" aria-hidden="true"></span>
            {{ loading ? '正在登录…' : '登录控制台' }}
          </button>
          <p class="login-status" role="status">{{ loading ? '正在验证账号，请稍候。' : '' }}</p>
        </form>

        <footer class="login-footer">
          <h3>首次使用？</h3>
          <p>请查看服务启动日志，获取初始账号与密码。</p>
          <a href="/health" target="_blank" rel="noopener noreferrer">健康检查<span class="sr-only">（在新窗口打开）</span><span aria-hidden="true"> ↗</span></a>
        </footer>
      </section>
    </div>
  </main>
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
    const showPassword = ref(false)
    const errorMessage = ref('')
    const usernameInput = ref(null)
    const passwordInput = ref(null)
    const fieldErrors = reactive({ username: '', password: '' })
    const loginData = reactive({ username: '', password: '' })

    // 已登录时替换当前记录，避免后退再次进入登录页。
    onMounted(() => {
      if (isLoggedIn()) router.replace('/')
    })

    // 仅呈现服务返回的文本，避免对象型错误被渲染为无意义的字符串。
    const getErrorMessage = (result, fallback) => {
      const message = result?.detail || result?.message
      return typeof message === 'string' && message.trim() ? message : fallback
    }

    const handleLogin = async () => {
      // 在任何异步工作之前加锁，阻止快速点击或连续 Enter 重复提交。
      if (loading.value) return
      errorMessage.value = ''
      fieldErrors.username = loginData.username.trim() ? '' : '请输入用户名'
      fieldErrors.password = loginData.password ? '' : '请输入密码'
      if (fieldErrors.username || fieldErrors.password) {
        const firstInvalidInput = fieldErrors.username ? usernameInput : passwordInput
        firstInvalidInput.value?.focus()
        return
      }

      loading.value = true
      try {
        const response = await fetch('/api/v2/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(loginData)
        })
        // 非 JSON 错误页也给出明确反馈，不泄露原始响应正文。
        const result = await response.json().catch(() => null)
        if (!response.ok) {
          errorMessage.value = getErrorMessage(result, '登录失败，请检查用户名和密码后重试。')
          return
        }

        const payload = result?.data || result
        // 保持 Rust token 与旧服务 access_token 的兼容及既有存储键名。
        const token = payload?.access_token || payload?.token
        if (typeof token !== 'string' || !token) {
          errorMessage.value = getErrorMessage(result, '登录失败，服务未返回有效凭据。')
          return
        }
        localStorage.setItem('access_token', token)
        localStorage.setItem('token_type', payload.token_type || 'bearer')
        await router.replace('/')
      } catch (error) {
        console.error('登录错误:', error)
        errorMessage.value = '登录未完成，请检查网络连接或浏览器存储设置后重试。'
      } finally {
        loading.value = false
      }
    }

    return {
      loginData, loading, showPassword, errorMessage, fieldErrors,
      usernameInput, passwordInput, handleLogin
    }
  }
}
</script>

<style scoped>
/* 沿用全局主题变量，登录页与控制台保持同一套明暗语义。 */
.login-page {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 48px 24px;
  background: var(--color-bg-page);
  color: var(--color-text);
}

.login-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 420px;
  align-items: center;
  gap: clamp(48px, 8vw, 112px);
  width: min(100%, 1000px);
}

.brand-lockup { display: flex; align-items: center; gap: 12px; }
.brand-mark {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-primary-dark);
  font-size: 15px;
  font-weight: 750;
  letter-spacing: -1px;
}
.brand-name { font-size: 18px; font-weight: 650; letter-spacing: -0.3px; }
.brand-name span { display: block; margin-top: 3px; color: var(--color-text-secondary); font-size: 12px; font-weight: 400; letter-spacing: 1px; }
.brand-copy { margin: 64px 0 48px; }
.eyebrow { color: var(--color-text-secondary); font-size: 12px; font-weight: 600; letter-spacing: 1.6px; line-height: 1.5; }
.brand-copy h1 { margin: 14px 0 18px; font-size: clamp(30px, 3.5vw, 42px); font-weight: 650; letter-spacing: -1px; line-height: 1.25; }
.brand-description { max-width: 320px; color: var(--color-text-secondary); font-size: 15px; line-height: 1.9; }
.brand-note { padding-top: 20px; border-top: 1px solid var(--color-border); color: var(--color-text-secondary); font-size: 12px; line-height: 1.8; }

.login-card {
  min-width: 0;
  padding: 36px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  background: var(--color-bg);
  box-shadow: var(--shadow-sm);
}
.login-header { margin-bottom: 30px; }
.login-header h2 { margin: 10px 0; font-size: 26px; font-weight: 650; line-height: 1.3; }
.login-header > p:last-child { color: var(--color-text-secondary); font-size: 14px; line-height: 1.7; }
.form-group + .form-group { margin-top: 20px; }
.form-group label { display: block; margin-bottom: 8px; font-size: 14px; font-weight: 550; }
.form-group input {
  width: 100%;
  min-height: 46px;
  padding: 11px 13px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
  font-size: 14px;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}
.form-group input::placeholder { color: var(--color-text-secondary); opacity: 0.8; }
.form-group input[aria-invalid="true"] { border-color: var(--color-danger); }
.form-group input:focus { outline: 2px solid var(--color-primary); outline-offset: 2px; border-color: var(--color-primary); }
.form-group input:read-only { background: var(--color-bg-page); }
.password-field { position: relative; }
.password-field input { padding-right: 68px; }
.password-toggle {
  position: absolute;
  top: 3px;
  right: 3px;
  min-width: 58px;
  min-height: 40px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.password-toggle:hover { background: var(--color-bg-page); color: var(--color-text); }
.field-error { margin-top: 8px; color: var(--color-text); font-size: 12px; line-height: 1.6; }
.login-feedback { margin-top: 20px; }
.login-error { margin-bottom: 16px; padding: 10px 12px; border-left: 3px solid var(--color-danger); border-radius: var(--radius-sm); background: var(--color-bg-page); color: var(--color-text); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.login-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  min-height: 46px;
  padding: 11px 16px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: var(--color-primary-dark);
  color: #fff;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.login-button:hover:not(:disabled) { filter: brightness(0.9); }
.login-button:disabled { cursor: wait; opacity: 0.75; }
/* 所有交互元素提供清晰的键盘焦点，不只依赖鼠标悬浮。 */
.password-toggle:focus-visible, .login-button:focus-visible, .login-footer a:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 3px; }
.loading-indicator { width: 14px; height: 14px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: login-spin 0.8s linear infinite; }
.login-status { min-height: 18px; margin-top: 8px; color: var(--color-text-secondary); font-size: 12px; line-height: 1.5; text-align: center; }
.login-footer { margin-top: 22px; padding-top: 22px; border-top: 1px solid var(--color-border-light); }
.login-footer h3 { font-size: 13px; font-weight: 550; }
.login-footer p { margin: 8px 0 12px; color: var(--color-text-secondary); font-size: 12px; line-height: 1.8; }
.login-footer a { border-radius: 2px; color: var(--color-text-secondary); font-size: 12px; text-underline-offset: 4px; }
.login-footer a:hover { color: var(--color-text); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
@keyframes login-spin { to { transform: rotate(360deg); } }

/* 窄屏保留品牌标识，将表单放在阅读与操作的主路径上。 */
@media (max-width: 760px) {
  .login-page { padding: 32px 20px; }
  .login-shell { grid-template-columns: minmax(0, 420px); justify-content: center; gap: 28px; }
  .brand-copy { margin: 24px 0 0; }
  .brand-copy .eyebrow, .brand-note, .brand-description { display: none; }
  .brand-copy h1 { margin: 0; font-size: 26px; }
  .login-card { padding: 28px; }
}
@media (max-width: 380px) {
  .login-page { padding: 24px 16px; }
  .login-card { padding: 24px 20px; }
}
@media (prefers-reduced-motion: reduce) {
  .form-group input { transition: none; }
  .loading-indicator { animation: none; }
}
</style>
