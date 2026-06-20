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
      window.addEventListener('show-password-modal', openPasswordModal)
    })
    onUnmounted(() => {
      window.removeEventListener('show-password-modal', openPasswordModal)
    })

    return {
      items, msg, save,
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