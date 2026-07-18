<template>
  <div class="page">
    <h1 class="page-title">系统设置</h1>
    <div v-if="msg" class="tip">{{ msg }}</div>

    <div class="panel">
      <table class="data-table">
        <thead><tr><th>配置项</th><th>值</th><th>说明</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="s in items" :key="s.key">
            <td class="key">{{ s.key }}</td>
            <td>
              <input v-model="s.value" class="input" :type="s.is_secret ? 'password' : 'text'" />
            </td>
            <td>{{ s.description || '—' }}</td>
            <td><button class="link" @click="save(s)">保存</button></td>
          </tr>
          <tr v-if="!items.length"><td colspan="4" class="empty">暂无配置</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 外部控制密钥（MCP / 外部诊断专用，独立于登录） -->
    <div class="panel" style="margin-top: 20px;">
      <div class="panel-head">
        <h2 class="panel-title">外部控制密钥（MCP 接入）</h2>
        <div class="panel-actions">
          <button class="btn" @click="loadExtToken" :disabled="extLoading">查看密钥</button>
          <button class="btn btn-primary" @click="rotateExtToken" :disabled="extLoading">重新生成</button>
        </div>
      </div>
      <p class="hint">
        供 MCP / 外部诊断工具调用 <code>/api/v2/ext/*</code> 接口鉴权（请求头 <code>X-External-Token</code>）。
        与登录账号无关，可随时轮换；轮换后旧密钥立即失效，需同步更新 MCP 配置。
      </p>
      <div class="token-row">
        <input :value="extToken" class="input full" :type="extShow ? 'text' : 'password'"
               readonly placeholder="点击「查看密钥」显示" />
        <button class="btn" @click="extShow = !extShow" :disabled="!extToken">{{ extShow ? '隐藏' : '显示' }}</button>
        <button class="btn" @click="copyExtToken" :disabled="!extToken">复制</button>
      </div>
    </div>

    <!-- 客户端签名校验密钥（与 wasm 内置值一致，用于 Worker 验签） -->
    <div class="panel" style="margin-top: 20px;">
      <div class="panel-head">
        <h2 class="panel-title">客户端签名密钥</h2>
        <div class="panel-actions">
          <button class="btn" @click="genSignSecret">随机生成</button>
          <button class="btn btn-primary" @click="saveSignSecret" :disabled="signSaving">
            {{ signSaving ? '保存中...' : '保存并下发' }}
          </button>
        </div>
      </div>
      <p class="hint">
        用于校验客户端（ede.js）请求签名，须与 <code>wasm-sign</code> 内置 <code>SIGN_SECRET</code>
        <strong>完全一致</strong>。修改密钥需同步重新编译 sign.wasm 并部署，否则签名将失配。
        当前状态：<strong>{{ signConfigured ? `已配置（${signLength} 位）` : '未配置' }}</strong>
      </p>
      <div class="token-row">
        <input v-model="signSecret" class="input full" :type="signShow ? 'text' : 'password'"
               placeholder="输入或随机生成签名密钥（留空保存则清除，等同关闭校验）" autocomplete="new-password" />
        <button class="btn" @click="signShow = !signShow" :disabled="!signSecret">{{ signShow ? '隐藏' : '显示' }}</button>
        <button class="btn" @click="copySignSecret" :disabled="!signSecret">复制</button>
      </div>
      <p class="hint" v-if="signSecret">
        ⚠️ 随机生成的密钥请<strong>先复制并填入 wasm-sign/assembly/config.ts 重新编译部署</strong>，再点「保存并下发」，否则两端不一致会导致验签失败。
      </p>
    </div>


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
import { reactive, ref, onMounted, onUnmounted } from 'vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'Settings',
  setup() {
    const items = ref([])
    const msg = ref('')

    // 客户端签名密钥
    const signSecret = ref('')
    const signConfigured = ref(false)
    const signLength = ref(0)
    const signSaving = ref(false)
    const signShow = ref(false)

    // 随机生成 48 位 base64url 密钥(与 wasm-sign 生成规格一致,无特殊字符)
    const genSignSecret = () => {
      const bytes = new Uint8Array(36)
      crypto.getRandomValues(bytes)
      let bin = ''
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
      signSecret.value = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
      signShow.value = true  // 生成后自动显示,便于复制到 config.ts
      msg.value = '已生成随机密钥，请先复制填入 config.ts 重新编译，再保存下发'
    }

    const copySignSecret = async () => {
      try {
        await navigator.clipboard.writeText(signSecret.value)
        msg.value = '已复制签名密钥'
      } catch (e) { msg.value = '复制失败，请手动选择复制' }
    }

    const loadSignSecret = async () => {
      try {
        const res = await apiV2('/settings/sign-secret')
        signConfigured.value = !!(res.data && res.data.configured)
        signLength.value = (res.data && res.data.length) || 0
      } catch (e) { /* 忽略:未配置时不报错 */ }
    }

    const saveSignSecret = async () => {
      signSaving.value = true
      msg.value = ''
      try {
        const res = await apiV2('/settings/sign-secret', {
          method: 'PUT', body: { value: signSecret.value },
        })
        msg.value = res.message || '已保存'
        signSecret.value = ''  // 保存后清空输入框,不回显
        await loadSignSecret()
      } catch (e) { msg.value = e.message }
      finally { signSaving.value = false }
    }

    // 外部控制密钥
    const extToken = ref('')
    const extShow = ref(false)
    const extLoading = ref(false)

    const loadExtToken = async () => {
      extLoading.value = true
      msg.value = ''
      try {
        const res = await apiV2('/ext/token')
        extToken.value = res.data.token || ''
        extShow.value = true
      } catch (e) {
        msg.value = '获取外部控制密钥失败：' + e.message
      } finally {
        extLoading.value = false
      }
    }

    const rotateExtToken = async () => {
      if (!confirm('轮换后旧密钥立即失效，MCP 配置需同步更新。确认？')) return
      extLoading.value = true
      msg.value = ''
      try {
        const res = await apiV2('/ext/token/rotate', { method: 'POST' })
        extToken.value = res.data.token || ''
        extShow.value = true
        msg.value = res.message || '密钥已轮换，请复制并更新 MCP 配置'
      } catch (e) {
        msg.value = '轮换失败：' + e.message
      } finally {
        extLoading.value = false
      }
    }

    const copyExtToken = async () => {
      if (!extToken.value) return
      try {
        await navigator.clipboard.writeText(extToken.value)
        msg.value = '密钥已复制到剪贴板'
      } catch {
        msg.value = '复制失败，请手动选中文本复制'
      }
    }
    const showPasswordModal = ref(false)
    const passwordLoading = ref(false)
    const passwordForm = reactive({
      old_password: '',
      new_password: '',
      confirm_password: ''
    })

    const load = async () => {
      msg.value = ''
      try {
        const res = await apiV2('/settings')
        items.value = res.data || []
      } catch (e) { msg.value = e.message }
    }

    const save = async (s) => {
      try {
        await apiV2(`/settings/${encodeURIComponent(s.key)}`, { method: 'PUT', body: { value: s.value } })
        msg.value = `已保存 ${s.key}`
      } catch (e) { msg.value = e.message }
    }

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
        msg.value = '请完整填写旧密码、新密码和确认密码'
        return
      }
      if (passwordForm.new_password.length < 8) {
        msg.value = '新密码长度至少 8 位'
        return
      }
      if (passwordForm.new_password !== passwordForm.confirm_password) {
        msg.value = '两次输入的新密码不一致'
        return
      }
      if (passwordForm.old_password === passwordForm.new_password) {
        msg.value = '新密码不能与旧密码相同'
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
        msg.value = res.message || '密码修改成功，请重新登录'
        // 修改密码后主动清除本地令牌，避免继续使用旧会话造成困惑
        setTimeout(() => {
          localStorage.removeItem('access_token')
          localStorage.removeItem('token_type')
          window.location.href = '/login'
        }, 800)
      } catch (e) {
        msg.value = e.message
      } finally {
        passwordLoading.value = false
      }
    }

    onMounted(() => {
      load()
      loadSignSecret()
      window.addEventListener('show-password-modal', openPasswordModal)
    })
    onUnmounted(() => {
      window.removeEventListener('show-password-modal', openPasswordModal)
    })

    return {
      items, msg, save,
      signSecret, signConfigured, signLength, signSaving, saveSignSecret,
      signShow, genSignSecret, copySignSecret,
      extToken, extShow, extLoading, loadExtToken, rotateExtToken, copyExtToken,
      showPasswordModal, passwordForm, passwordLoading,
      closePasswordModal, submitPassword
    }
  }
}
</script>

<style scoped>
.page { padding: 24px; }
.page-title { font-size: 22px; margin-bottom: 20px; color: #333; }
.tip { background: #e6f4ff; border: 1px solid #91caff; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; color: #0958d9; }
.panel { background: #fff; border-radius: 10px; padding: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
.data-table th { color: #888; font-weight: 500; }
.key { font-family: monospace; font-size: 12px; }
.input { padding: 6px 10px; border: 1px solid #d9d9d9; border-radius: 6px; min-width: 240px; }
.input.full { width: 100%; min-width: 0; }
.link { background: none; border: none; color: #1677ff; cursor: pointer; font-size: 13px; }
.empty { text-align: center; color: #999; padding: 20px; }
/* 外部控制密钥面板 */
.panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.panel-title { font-size: 16px; color: #333; margin: 0; }
.panel-actions { display: flex; gap: 8px; }
.hint { color: #888; font-size: 13px; margin-bottom: 12px; line-height: 1.6; }
.hint code { background: #f5f5f5; padding: 1px 5px; border-radius: 3px; font-family: monospace; color: #d56; }
.token-row { display: flex; gap: 8px; align-items: center; }
.token-row .input { flex: 1; font-family: monospace; font-size: 13px; }
.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { width: 420px; max-width: calc(100vw - 32px); background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 10px 32px rgba(0,0,0,0.18); }
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.modal-header h2 { font-size: 18px; color: #333; }
.modal-close { border: none; background: transparent; cursor: pointer; font-size: 22px; color: #999; line-height: 1; }
.form-item { margin-bottom: 14px; }
.form-item label { display: block; margin-bottom: 6px; color: #555; font-size: 13px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.btn { padding: 8px 16px; border: 1px solid #d9d9d9; background: #fff; border-radius: 6px; cursor: pointer; }
.btn:disabled { cursor: not-allowed; opacity: .65; }
.btn-primary { background: #1677ff; color: #fff; border-color: #1677ff; }
</style>