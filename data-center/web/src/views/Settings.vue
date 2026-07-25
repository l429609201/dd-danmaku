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

    <!-- MCP 接入配置：生成可直接粘贴到 AI 客户端的 JSON 配置 -->
    <div class="panel" style="margin-top: 20px;">
      <div class="panel-head">
        <h2 class="panel-title">MCP 接入配置</h2>
        <div class="panel-actions">
          <button class="btn" :class="{ 'btn-primary': mcpMode === 'http' }" @click="mcpMode = 'http'">HTTP（推荐）</button>
          <button class="btn" :class="{ 'btn-primary': mcpMode === 'stdio' }" @click="mcpMode = 'stdio'">stdio</button>
        </div>
      </div>
      <p class="hint">
        把下面 JSON 粘贴进 AI 客户端的 MCP 配置文件即可接入诊断工具（
        <code>diag_snapshot</code> / <code>diag_slow_sql</code> 等 8 个）。
        <template v-if="mcpMode === 'http'">
          HTTP 方式无需本地装 Python 依赖，直连本地端 <code>/api/v2/ext/mcp</code> 端点。
        </template>
        <template v-else>
          stdio 方式需要本机有 <code>uv</code> 与项目源码，适合本地开发调试。
        </template>
      </p>

      <div class="mcp-form">
        <div class="mcp-field">
          <label>本地端地址</label>
          <input v-model="mcpBaseUrl" class="input" placeholder="http://192.168.1.10:7759" />
        </div>
        <div v-if="mcpMode === 'stdio'" class="mcp-field mcp-field--wide">
          <label>server.py 绝对路径</label>
          <input v-model="mcpScriptPath" class="input" placeholder="/opt/dd-danmaku/data-center/mcp_server/server.py" />
        </div>
      </div>

      <div v-if="!extToken" class="tip tip--warn">
        请先点上方「查看密钥」获取密钥，配置里的 token 才会填上真实值。
      </div>

      <div class="code-block">
        <button class="btn code-copy" @click="copyMcpConfig">复制配置</button>
        <pre class="code-pre">{{ mcpConfigText }}</pre>
      </div>

      <p class="hint">
        配置文件位置参考：Claude Desktop 为 <code>claude_desktop_config.json</code>，
        其它客户端见各自文档。保存后重启客户端生效。
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
import { reactive, ref, computed, onMounted, onUnmounted } from 'vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'Settings',
  setup() {
    const items = ref([])
    const msg = ref('')

    // 外部控制密钥
    const extToken = ref('')
    const extShow = ref(false)
    const extLoading = ref(false)

    // MCP 接入配置：http（直连本地端端点）/ stdio（本地起 server.py）
    const mcpMode = ref('http')
    // 默认用当前浏览器访问地址，多数情况就是本地端地址，省得用户手填
    const mcpBaseUrl = ref(window.location.origin)
    const mcpScriptPath = ref('/opt/dd-danmaku/data-center/mcp_server/server.py')

    // 生成可直接粘贴的 MCP 配置 JSON；密钥未获取时用占位符提示
    const mcpConfigText = computed(() => {
      const token = extToken.value || '<点上方「查看密钥」获取>'
      const base = (mcpBaseUrl.value || '').replace(/\/+$/, '')
      if (mcpMode.value === 'http') {
        return JSON.stringify({
          mcpServers: {
            'dd-danmaku-control': {
              type: 'http',
              url: `${base}/api/v2/ext/mcp`,
              headers: { Authorization: `Bearer ${token}` },
            },
          },
        }, null, 2)
      }
      return JSON.stringify({
        mcpServers: {
          'dd-danmaku-control': {
            command: 'uv',
            args: ['run', '--with', 'mcp[cli]', '--with', 'httpx',
                   'python', mcpScriptPath.value],
            env: { DDC_BASE_URL: base, DDC_EXT_TOKEN: token },
          },
        },
      }, null, 2)
    })

    const copyMcpConfig = async () => {
      try {
        await navigator.clipboard.writeText(mcpConfigText.value)
        msg.value = extToken.value
          ? 'MCP 配置已复制到剪贴板'
          : 'MCP 配置已复制，但密钥仍是占位符，请先「查看密钥」再复制'
      } catch {
        msg.value = '复制失败，请手动选中文本复制'
      }
    }

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
      window.addEventListener('show-password-modal', openPasswordModal)
    })
    onUnmounted(() => {
      window.removeEventListener('show-password-modal', openPasswordModal)
    })

    return {
      items, msg, save,
      extToken, extShow, extLoading, loadExtToken, rotateExtToken, copyExtToken,
      mcpMode, mcpBaseUrl, mcpScriptPath, mcpConfigText, copyMcpConfig,
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
/* MCP 接入配置面板 */
.tip--warn { background: #fffbe6; border-color: #ffe58f; color: #ad6800; }
.mcp-form { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.mcp-field { display: flex; flex-direction: column; gap: 6px; }
.mcp-field label { color: #555; font-size: 13px; }
.mcp-field .input { min-width: 280px; }
.mcp-field--wide .input { min-width: 420px; }
.code-block { position: relative; }
.code-copy { position: absolute; top: 10px; right: 10px; z-index: 1; font-size: 12px; padding: 5px 12px; }
.code-pre { margin: 0; background: #1e1e1e; color: #d4d4d4; padding: 16px; padding-right: 100px;
  border-radius: 8px; font-size: 12px; line-height: 1.7; overflow-x: auto;
  font-family: 'Consolas', 'Monaco', monospace; white-space: pre; }
</style>