<template>
  <div class="page">
    <div class="panel">
      <div class="panel-head">
        <h2 class="panel-title">OAuth 配置</h2>
        <div class="head-actions">
          <button class="btn" :disabled="pushing" @click="push">{{ pushing ? '下发中...' : '手动下发' }}</button>
          <button class="btn btn-primary" @click="openCreate">新增配置</button>
        </div>
      </div>
      <p class="hint">
        Worker 的 OAuth 登录配置。此处保存后经长连接下发并存入 DO，
        Worker 侧<strong>优先使用下发值</strong>，CF 环境变量 <code>OAUTH_CONFIG</code> 仅作冷启动兜底。
        未创建任何配置时行为与改造前一致（继续用环境变量）。
      </p>
      <div v-if="msg" class="tip">{{ msg }}</div>

      <table class="data-table">
        <thead><tr>
          <th>启用</th><th>JWT 密钥</th><th>有效期</th><th>允许用户</th><th>Provider</th><th>备注</th><th>操作</th>
        </tr></thead>
        <tbody>
          <tr v-for="r in items" :key="r.id">
            <td><span :class="['badge', r.enabled ? 'ok' : 'off']">{{ r.enabled ? '生效中' : '停用' }}</span></td>
            <td class="key">{{ r.jwt_secret || '—' }}</td>
            <td>{{ r.jwt_expire_hours }} 小时</td>
            <td>{{ (r.allowed_users || []).length ? (r.allowed_users || []).join(', ') : '不限' }}</td>
            <td>
              <span v-if="!(r.providers || []).length" class="muted">未配置</span>
              <span v-for="p in (r.providers || [])" :key="p.name" :class="['badge', p.complete ? 'ok' : 'warn']">
                {{ p.name }}{{ p.complete ? '' : '(不完整)' }}
              </span>
            </td>
            <td>{{ r.remark || '—' }}</td>
            <td class="actions">
              <button class="link" @click="openEdit(r)">编辑</button>
              <button class="link" @click="toggle(r)">{{ r.enabled ? '停用' : '启用' }}</button>
              <button class="link danger" @click="del(r.id)">删除</button>
            </td>
          </tr>
          <tr v-if="!items.length"><td colspan="7" class="empty">暂无 OAuth 配置（当前 Worker 使用环境变量兜底）</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 新增/编辑弹窗 -->
    <div v-if="showEdit" class="modal-mask" @click.self="showEdit=false">
      <div class="modal wide">
        <div class="modal-header">
          <h2>{{ editId ? '编辑' : '新增' }} OAuth 配置</h2>
          <button class="modal-close" @click="showEdit=false">×</button>
        </div>

        <div class="form-row">
          <div class="form-item flex1">
            <label>JWT 签名密钥{{ editId ? '（留空不修改）' : '' }}</label>
            <div class="token-row">
              <input v-model="form.jwtSecret" class="input full" :type="secretShow ? 'text' : 'password'"
                     placeholder="用于签发登录态 JWT" />
              <button class="btn" @click="genSecret">随机生成</button>
              <button class="btn" @click="secretShow = !secretShow" :disabled="!form.jwtSecret">
                {{ secretShow ? '隐藏' : '显示' }}
              </button>
            </div>
          </div>
          <div class="form-item w160">
            <label>JWT 有效期（小时）</label>
            <input v-model.number="form.jwtExpireHours" type="number" min="1" class="input full" />
          </div>
        </div>

        <div class="form-item">
          <label>允许登录的用户（每行一个，留空 = 不限制）</label>
          <textarea v-model="allowedUsersText" class="json-area sm"
                    placeholder="github 用户名，一行一个"></textarea>
        </div>

        <div class="form-item">
          <div class="sub-head">
            <label>Provider 配置</label>
            <button class="link" @click="addProvider">+ 添加 Provider</button>
          </div>
          <p class="hint">五项 URL/凭据必须填全才会生效，缺一即该 provider 被 Worker 忽略。</p>
          <div v-for="(p, i) in form.providers" :key="i" class="provider-card">
            <div class="provider-head">
              <input v-model="p.name" class="input name" placeholder="provider 名（如 github）" />
              <button class="link danger" @click="form.providers.splice(i, 1)">移除</button>
            </div>
            <div class="form-row">
              <input v-model="p.clientId" class="input flex1" placeholder="clientId" />
              <input v-model="p.clientSecret" class="input flex1" type="password"
                     :placeholder="editId ? 'clientSecret（留空不修改）' : 'clientSecret'" />
            </div>
            <input v-model="p.authorizeUrl" class="input full mt6" placeholder="authorizeUrl" />
            <input v-model="p.tokenUrl" class="input full mt6" placeholder="tokenUrl" />
            <input v-model="p.userInfoUrl" class="input full mt6" placeholder="userInfoUrl" />
            <input v-model="p.scope" class="input full mt6" placeholder="scope（可选，如 read:user）" />
          </div>
          <p v-if="!form.providers.length" class="muted">尚未添加 provider</p>
        </div>

        <div class="form-item"><label>备注</label><input v-model="form.remark" class="input full" /></div>
        <label class="chk"><input type="checkbox" v-model="form.enabled" /> 启用此配置（同时只有一条生效）</label>

        <div class="modal-actions">
          <button class="btn" @click="showEdit=false">取消</button>
          <button class="btn btn-primary" :disabled="saving" @click="submit">
            {{ saving ? '提交中...' : '保存并下发' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { computed, reactive, ref, onMounted } from 'vue'
import { apiV2 } from '../utils/api.js'

// 后端返回的脱敏占位：提交时原样回传表示「保留原值不修改」
const REDACTED = '***REDACTED***'

export default {
  name: 'OAuthConfig',
  setup() {
    const items = ref([])
    const msg = ref('')
    const showEdit = ref(false)
    const saving = ref(false)
    const pushing = ref(false)
    const editId = ref(null)
    const secretShow = ref(false)
    const form = reactive({
      enabled: true, jwtSecret: '', jwtExpireHours: 720,
      allowedUsers: [], providers: [], remark: '',
    })

    // 允许用户列表 <-> 多行文本互转（编辑体验比数组直观）
    const allowedUsersText = computed({
      get: () => (form.allowedUsers || []).join('\n'),
      set: (v) => {
        form.allowedUsers = String(v || '')
          .split(/[\n,]/).map(s => s.trim()).filter(Boolean)
      },
    })

    const load = async () => {
      try {
        const s = await apiV2('/oauth-config')
        items.value = (s.data && s.data.items) || []
      } catch (e) { msg.value = e.message }
    }

    // 随机生成 JWT 密钥（48 位，前端生成即可，无需后端接口）
    const genSecret = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
      const buf = new Uint8Array(48)
      crypto.getRandomValues(buf)
      form.jwtSecret = Array.from(buf, b => chars[b % chars.length]).join('')
      secretShow.value = true
      msg.value = '已生成随机 JWT 密钥，保存后立即下发生效'
    }

    const addProvider = () => {
      form.providers.push({
        name: '', clientId: '', clientSecret: '',
        authorizeUrl: '', tokenUrl: '', userInfoUrl: '', scope: '',
      })
    }

    const resetForm = () => {
      form.enabled = true; form.jwtSecret = ''; form.jwtExpireHours = 720
      form.allowedUsers = []; form.providers = []; form.remark = ''
      secretShow.value = false
    }
    const openCreate = () => { editId.value = null; resetForm(); showEdit.value = true }
    const openEdit = (r) => {
      editId.value = r.id
      form.enabled = r.enabled
      form.jwtSecret = ''  // 留空 = 不修改
      form.jwtExpireHours = r.jwt_expire_hours || 720
      form.allowedUsers = [...(r.allowed_users || [])]
      // 列表接口只回 provider 摘要，编辑时拉完整（clientSecret 仍为脱敏占位）
      form.providers = (r.providers || []).map(p => ({
        name: p.name || '', clientId: p.clientId || '',
        clientSecret: '',  // 留空 = 不修改
        authorizeUrl: p.authorizeUrl || '', tokenUrl: p.tokenUrl || '',
        userInfoUrl: p.userInfoUrl || '', scope: p.scope || '',
      }))
      form.remark = r.remark || ''
      secretShow.value = false
      showEdit.value = true
    }

    const submit = async () => {
      // provider 名必填，否则后端无法索引
      if (form.providers.some(p => !p.name)) { msg.value = '请填写每个 provider 的名称'; return }
      saving.value = true
      try {
        const providers = {}
        for (const p of form.providers) {
          const item = {
            clientId: p.clientId || '', authorizeUrl: p.authorizeUrl || '',
            tokenUrl: p.tokenUrl || '', userInfoUrl: p.userInfoUrl || '',
            scope: p.scope || '',
          }
          // 编辑态留空表示保留原 secret，用占位符告知后端
          item.clientSecret = p.clientSecret || (editId.value ? REDACTED : '')
          providers[p.name] = item
        }
        const body = {
          enabled: form.enabled,
          jwtExpireHours: form.jwtExpireHours || 720,
          allowedUsers: form.allowedUsers,
          providers,
          remark: form.remark,
        }
        if (form.jwtSecret) body.jwtSecret = form.jwtSecret
        else if (editId.value) body.jwtSecret = REDACTED

        const res = editId.value
          ? await apiV2(`/oauth-config/${editId.value}`, { method: 'PUT', body })
          : await apiV2('/oauth-config', { method: 'POST', body })
        msg.value = res.message || '保存成功'
        showEdit.value = false
        load()
      } catch (e) { msg.value = e.message }
      finally { saving.value = false }
    }

    const toggle = async (r) => {
      try {
        const res = await apiV2(`/oauth-config/${r.id}`, { method: 'PUT', body: { enabled: !r.enabled } })
        msg.value = res.message || '已更新'
        load()
      } catch (e) { msg.value = e.message }
    }
    const del = async (id) => {
      if (!confirm('确认删除该 OAuth 配置？删除后 Worker 将回退到环境变量兜底。')) return
      try { const res = await apiV2(`/oauth-config/${id}`, { method: 'DELETE' }); msg.value = res.message || '已删除'; load() }
      catch (e) { msg.value = e.message }
    }
    const push = async () => {
      pushing.value = true
      try { const res = await apiV2('/oauth-config/push', { method: 'POST' }); msg.value = res.message || '已下发' }
      catch (e) { msg.value = e.message }
      finally { pushing.value = false }
    }

    onMounted(load)
    return { items, msg, showEdit, saving, pushing, editId, form, secretShow,
      allowedUsersText, openCreate, openEdit, submit, toggle, del, push,
      genSecret, addProvider }
  }
}
</script>

<style scoped>
.page { padding: 4px; }
.panel { background: #fff; border-radius: 10px; padding: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); margin-bottom: 24px; }
.panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.panel-title { font-size: 16px; color: #333; }
.head-actions { display: flex; gap: 10px; }
.hint { color: #666; font-size: 12px; margin-bottom: 10px; line-height: 1.7; }
.hint code { background: #f0f0f0; padding: 1px 5px; border-radius: 3px; font-size: 11px; }
.tip { background: #e6f4ff; border: 1px solid #91caff; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; color: #0958d9; font-size: 13px; }
.muted { color: #999; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
.data-table th { color: #888; font-weight: 500; }
.key { font-family: monospace; font-size: 12px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.link { background: none; border: none; color: #1677ff; cursor: pointer; font-size: 13px; padding: 0; }
.link.danger { color: #cf1322; }
.empty { text-align: center; color: #999; padding: 20px; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; background: #f0f0f0; color: #888; }
.badge.on { background: #f6ffed; color: #389e0d; }
.btn { padding: 8px 16px; border: 1px solid #d9d9d9; background: #fff; border-radius: 6px; cursor: pointer; font-size: 13px; }
.btn:disabled { opacity: .6; cursor: not-allowed; }
.btn-primary { background: #1677ff; color: #fff; border-color: #1677ff; }
.btn-sm { padding: 4px 10px; font-size: 12px; }
.input { padding: 8px 12px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px; }
.input.full { width: 100%; box-sizing: border-box; }
.input.sm { width: 120px; }
.chk { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #555; margin-bottom: 14px; }
.token-row { display: flex; gap: 8px; align-items: center; }
.token-row .input.full { flex: 1; }
.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { width: 620px; max-width: 94vw; max-height: 88vh; overflow-y: auto; background: #fff; border-radius: 12px; padding: 20px; }
.modal.wide { width: 680px; }
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.modal-close { border: none; background: none; font-size: 22px; color: #999; cursor: pointer; }
.form-item { margin-bottom: 14px; }
.form-item label { display: block; margin-bottom: 6px; color: #555; font-size: 13px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.section-head { display: flex; justify-content: space-between; align-items: center; margin: 18px 0 10px; padding-top: 14px; border-top: 1px solid #f0f0f0; }
.section-head h3 { font-size: 14px; color: #333; }
.provider-card { border: 1px solid #e8e8e8; border-radius: 8px; padding: 14px; margin-bottom: 12px; background: #fafafa; }
.provider-head { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
.provider-head .input { flex: 1; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
</style>
