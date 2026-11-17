<template>
  <div class="page">
    <h1 class="page-title">系统设置</h1>
    <div v-if="msg" class="tip" :class="msgClass">{{ msg }}</div>

    <!-- 官方凭据独立保存；密钥不回显，留空代表保留已有配置。 -->
    <form class="panel upstream-panel" @submit.prevent="saveUpstream">
      <div class="panel-head">
        <h2 class="panel-title">弹弹官方上游</h2>
        <button class="btn" type="button" :disabled="upstreamLoading || upstreamSaving" @click="loadUpstream">重新读取</button>
      </div>
      <p class="hint">应用密钥加密存入数据库，不会回显。修改保存后对新请求生效，无需重启。</p>
      <p v-if="upstreamLoaded" class="hint">配置来源：{{ upstreamSourceLabel }}；密钥{{ upstream.secret_configured ? '已配置' : '未配置' }}。</p>
      <p v-if="upstreamLoaded && !upstream.encryption_ready" class="tip tip--warn">无法读取或创建本地加密参数，请检查 CONFIG_PATH 挂载目录的读写权限及 encryption-key.json 的 0600 权限。主密钥首次自动随机生成并持久化，请连同数据库一起备份；不要删除或替换，否则已有密钥无法解密。</p>
      <p v-if="upstreamError" class="tip tip--warn" role="alert">{{ upstreamError }}</p>
      <fieldset :disabled="!upstreamLoaded || upstreamLoading || upstreamSaving" class="upstream-fields">
        <div class="form-item">
          <label for="upstream-app-id">App ID</label>
          <input id="upstream-app-id" v-model="upstream.app_id" class="input full" autocomplete="off" required />
        </div>
        <div class="form-item">
          <label for="upstream-app-secret">App Secret（留空保留已有密钥）</label>
          <input id="upstream-app-secret" v-model="upstreamSecret" class="input full" type="password" autocomplete="new-password"
                 :placeholder="upstream.secret_configured ? '已配置，不回显；留空保持不变' : '请输入应用密钥'" />
        </div>
        <div class="form-item">
          <label for="upstream-user-agent">User-Agent（可选）</label>
          <input id="upstream-user-agent" v-model="upstream.user_agent" class="input full" autocomplete="off" />
        </div>
        <button class="btn btn-primary" type="submit" :disabled="!upstream.encryption_ready">
          {{ upstreamSaving ? '保存中...' : '保存官方凭据' }}
        </button>
      </fieldset>
    </form>

    <!-- 修改密码弹窗 -->
    <div v-if="showPasswordModal" class="modal-mask" @click.self="closePasswordModal">
      <div class="modal">
        <div class="modal-header">
          <h2>修改密码</h2>
          <button class="modal-close" @click="closePasswordModal">×</button>
        </div>
        <div class="form-item">
          <label>旧密码</label>
          <input v-model="passwordForm.old_password" class="input full" type="password" autocomplete="current-password" />
        </div>
        <div class="form-item">
          <label>新密码</label>
          <input v-model="passwordForm.new_password" class="input full" type="password" autocomplete="new-password" />
        </div>
        <div class="form-item">
          <label>确认新密码</label>
          <input v-model="passwordForm.confirm_password" class="input full" type="password" autocomplete="new-password" />
        </div>
        <div class="modal-actions">
          <button class="btn" :disabled="passwordLoading" @click="closePasswordModal">取消</button>
          <button class="btn btn-primary" :disabled="passwordLoading" @click="submitPassword">
            {{ passwordLoading ? '提交中...' : '确认修改' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { reactive, ref, computed, onMounted, onUnmounted } from 'vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'Settings',
  setup() {
    const msg = ref('')
    const msgClass = ref('')

    const setMsg = (text, warn = false) => {
      msg.value = text
      msgClass.value = warn ? 'tip--warn' : ''
    }

    // 官方密钥仅保存在当前表单内存中，保存成功及离开页面时清空。
    const upstream = reactive({ app_id: '', user_agent: '', secret_configured: false, source: '', encryption_ready: false })
    const upstreamSecret = ref('')
    const upstreamLoaded = ref(false)
    const upstreamLoading = ref(false)
    const upstreamSaving = ref(false)
    const upstreamError = ref('')

    const upstreamSourceLabel = computed(() => {
      const s = upstream.source
      if (s === 'database') return '数据库'
      if (s === 'env' || s === 'environment') return '环境变量'
      return '未配置'
    })

    const loadUpstream = async () => {
      upstreamLoading.value = true
      upstreamError.value = ''
      upstreamLoaded.value = false
      upstreamSecret.value = ''
      try {
        const data = await apiV2('/settings/dandanplay')
        Object.assign(upstream, data)
        upstreamLoaded.value = true
      } catch (e) {
        upstreamError.value = '读取官方凭据配置失败：' + e.message
      } finally {
        upstreamLoading.value = false
      }
    }

    const saveUpstream = async () => {
      if (!upstreamLoaded.value || upstreamSaving.value || !upstream.encryption_ready) return
      upstreamError.value = ''
      if ((upstream.source !== 'database' || !upstream.secret_configured) && !upstreamSecret.value) {
        upstreamError.value = '首次保存到数据库必须填写 App Secret（不会从环境变量复制）'
        return
      }
      upstreamSaving.value = true
      try {
        const body = { app_id: upstream.app_id, user_agent: upstream.user_agent.trim() || 'data-center-rust/0.1.0' }
        if (upstreamSecret.value) body.app_secret = upstreamSecret.value
        await apiV2('/settings/dandanplay', { method: 'PUT', body })
        upstreamSecret.value = ''
        setMsg('官方凭据已加密保存，新请求立即生效')
        await loadUpstream()
      } catch (e) {
        upstreamError.value = '保存官方凭据失败：' + e.message
      } finally {
        upstreamSaving.value = false
      }
    }

    const showPasswordModal = ref(false)
    const passwordLoading = ref(false)
    const passwordForm = reactive({
      old_password: '',
      new_password: '',
      confirm_password: ''
    })

    const resetPasswordForm = () => {
      passwordForm.old_password = ''
      passwordForm.new_password = ''
      passwordForm.confirm_password = ''
    }

    const openPasswordModal = () => {
      resetPasswordForm()
      msg.value = ''
      showPasswordModal.value = true
    }

    const closePasswordModal = () => {
      if (passwordLoading.value) return
      showPasswordModal.value = false
      resetPasswordForm()
    }

    const submitPassword = async () => {
      msg.value = ''
      if (!passwordForm.old_password || !passwordForm.new_password || !passwordForm.confirm_password) {
        setMsg('请完整填写旧密码、新密码和确认密码', true)
        return
      }
      if (passwordForm.new_password.length < 8) {
        setMsg('新密码长度至少 8 位', true)
        return
      }
      if (passwordForm.new_password !== passwordForm.confirm_password) {
        setMsg('两次输入的新密码不一致', true)
        return
      }
      if (passwordForm.old_password === passwordForm.new_password) {
        setMsg('新密码不能与旧密码相同', true)
        return
      }

      passwordLoading.value = true
      try {
        const res = await apiV2('/auth/change-password', {
          method: 'POST',
          body: {
            old_password: passwordForm.old_password,
            new_password: passwordForm.new_password
          }
        })
        showPasswordModal.value = false
        resetPasswordForm()
        // Rust 改密成功返回 204，无正文也必须继续清理会话并重新登录。
        setMsg(res?.message || '密码修改成功，请重新登录')
        // 修改密码后主动清除本地令牌，避免继续使用旧会话造成困惑
        setTimeout(() => {
          localStorage.removeItem('access_token')
          localStorage.removeItem('token_type')
          window.location.href = '/login'
        }, 800)
      } catch (e) {
        setMsg(e.message, true)
      } finally {
        passwordLoading.value = false
      }
    }

    onMounted(() => {
      loadUpstream()
      window.addEventListener('show-password-modal', openPasswordModal)
    })
    onUnmounted(() => {
      upstreamSecret.value = ''
      window.removeEventListener('show-password-modal', openPasswordModal)
    })

    return {
      msg, msgClass,
      upstream, upstreamSecret, upstreamLoaded, upstreamLoading, upstreamSaving, upstreamError,
      upstreamSourceLabel, loadUpstream, saveUpstream,
      showPasswordModal, passwordForm, passwordLoading,
      closePasswordModal, submitPassword
    }
  }
}
</script>

<style scoped>
/* 通用页面布局由 theme.css .page 提供，这里只补设置页专属样式。 */
.upstream-panel { margin-top: 0; }
.upstream-fields { border: 0; padding: 0; margin: 0; min-width: 0; }
.upstream-fields .input { box-sizing: border-box; }

.tip { background: color-mix(in srgb, var(--color-primary) 10%, transparent); border: 1px solid color-mix(in srgb, var(--color-primary) 40%, transparent); padding: 10px 14px; border-radius: var(--radius-md); margin-bottom: 16px; color: var(--color-primary-dark); }
.tip--warn { background: color-mix(in srgb, var(--color-warning) 10%, transparent); border-color: color-mix(in srgb, var(--color-warning) 50%, transparent); color: var(--color-warning); }

.panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.panel-title { font-size: 16px; color: var(--color-text); margin: 0; }
.hint { color: var(--color-text-secondary); font-size: 13px; margin-bottom: 12px; line-height: 1.6; }
.hint code { background: var(--color-bg-page); padding: 1px 5px; border-radius: var(--radius-sm); font-family: monospace; color: var(--color-danger); }

.form-item { margin-bottom: 14px; }
.form-item label { display: block; margin-bottom: 6px; color: var(--color-text-secondary); font-size: 13px; }

.input { padding: 6px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg); color: var(--color-text); min-width: 240px; }
.input.full { width: 100%; min-width: 0; }
.input:focus { outline: none; border-color: var(--color-primary); }

.btn { padding: 8px 16px; border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text); border-radius: var(--radius-md); cursor: pointer; transition: var(--transition-fast); }
.btn:hover:not(:disabled) { border-color: var(--color-primary); color: var(--color-primary); }
.btn:disabled { cursor: not-allowed; opacity: .55; }
.btn-primary { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.btn-primary:hover:not(:disabled) { background: var(--color-primary-dark); border-color: var(--color-primary-dark); color: #fff; }

/* 修改密码弹窗 */
.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { width: 420px; max-width: calc(100vw - 32px); background: var(--color-bg-elevated); border-radius: var(--radius-lg); padding: 24px; box-shadow: var(--shadow-lg); border: 1px solid var(--color-border); }
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.modal-header h2 { font-size: 18px; color: var(--color-text); margin: 0; }
.modal-close { border: none; background: transparent; cursor: pointer; font-size: 22px; color: var(--color-text-secondary); line-height: 1; }
.modal-close:hover { color: var(--color-text); }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
</style>
