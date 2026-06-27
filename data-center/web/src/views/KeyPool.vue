<template>
  <div class="page">
    <h1 class="page-title">密钥池</h1>
    <div class="toolbar">
      <button class="btn btn-primary" @click="load">刷新</button>
      <button class="btn" @click="openCreate">新增密钥</button>
      <button class="btn" @click="openImport">JSON 导入</button>
      <button class="btn" @click="exportJson">导出 JSON</button>
      <button class="btn" @click="resync">重新下发</button>
      <span v-if="updatedAt" class="muted">更新于 {{ updatedAt }}</span>
    </div>

    <div v-if="msg" class="tip">{{ msg }}</div>

    <!-- 密钥列表 -->
    <div class="panel">
      <h2 class="panel-title">密钥列表</h2>
      <table class="data-table">
        <thead><tr>
          <th>key_id</th><th>App ID</th><th>App Secret</th>
          <th>授权 UA（空=公共池）</th><th>请求 UA（空=随请求者）</th><th>启用</th><th>备注</th><th>操作</th>
        </tr></thead>
        <tbody>
          <tr v-for="r in items" :key="r.id">
            <td class="key">{{ r.key_id }}</td>
            <td class="msg">{{ r.app_id }}</td>
            <td class="key">{{ r.app_secret }}</td>
            <td>
              <span v-if="!r.auth_ua_keys || !r.auth_ua_keys.length" class="badge badge-pool">公共池</span>
              <span v-else v-for="u in r.auth_ua_keys" :key="u" class="badge">{{ u }}</span>
            </td>
            <td class="msg">
              <span v-if="r.forward_ua" :title="r.forward_ua">{{ r.forward_ua }}</span>
              <span v-else class="muted">随请求者</span>
            </td>
            <td>{{ r.enabled ? '是' : '否' }}</td>
            <td class="msg">{{ r.remark || '—' }}</td>
            <td class="actions">
              <button class="link" @click="openEdit(r)">编辑</button>
              <button class="link" @click="toggle(r)">{{ r.enabled ? '停用' : '启用' }}</button>
              <button class="link danger" @click="del(r.id)">删除</button>
            </td>
          </tr>
          <tr v-if="!items.length"><td colspan="8" class="empty">暂无密钥，使用 env APP_KEY_POOL 兜底</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 限流状态 -->
    <div class="panel" v-if="states.length">
      <h2 class="panel-title">Worker 密钥限流状态（当日 UTC+8）</h2>
      <div v-for="st in states" :key="st.worker_id" class="state-block">
        <div class="state-head">
          <b>{{ st.worker_id }}</b>
          <span class="muted">来源:{{ st.keys_source }} / 密钥数:{{ st.key_count }} / 重置日:{{ st.reset_date || '—' }} / 上报:{{ fmt(st.updated_at) }}</span>
        </div>
        <table class="data-table">
          <thead><tr><th>密钥</th><th v-for="g in groups" :key="g">{{ g }}</th></tr></thead>
          <tbody>
            <tr v-for="(grp, kid) in st.key_state" :key="kid">
              <td class="key">{{ kid }}</td>
              <td v-for="g in groups" :key="g">
                <span v-if="grp[g] && grp[g].limited" class="badge badge-limited" :title="fmtTs(grp[g].limitedAt)">限流</span>
                <span v-else class="badge badge-ok">正常</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 新增/编辑弹窗 -->
    <div v-if="showEdit" class="modal-mask" @click.self="showEdit=false">
      <div class="modal">
        <div class="modal-header"><h2>{{ editId ? '编辑' : '新增' }}密钥</h2><button class="modal-close" @click="showEdit=false">×</button></div>
        <div class="form-item"><label>key_id（唯一标识）</label><input v-model="form.key_id" class="input full" :disabled="!!editId" /></div>
        <div class="form-item"><label>App ID</label><input v-model="form.app_id" class="input full" /></div>
        <div class="form-item"><label>App Secret{{ editId ? '（留空不修改）' : '' }}</label><input v-model="form.app_secret" class="input full" /></div>
        <div class="form-item">
          <label>授权 UA（不选=公共轮换池）</label>
          <div class="ua-checks">
            <label v-for="u in uaKeys" :key="u.ua_key" class="ua-check">
              <input type="checkbox" :value="u.ua_key" v-model="form.auth_ua_keys" />
              {{ u.ua_key }} <span class="muted">{{ u.user_agent }}</span>
            </label>
            <span v-if="!uaKeys.length" class="muted">暂无 UA 规则，先到「UA 限流」添加</span>
          </div>
        </div>
        <div class="form-item">
          <label>请求 UA（留空=转发请求者的 UA；填写则请求官方时用此 UA）</label>
          <input v-model="form.forward_ua" class="input full" placeholder="留空=随请求者；例如 dandanplay/3.0" />
        </div>
        <div class="form-item"><label>备注</label><input v-model="form.remark" class="input full" /></div>
        <label class="chk"><input type="checkbox" v-model="form.enabled" /> 启用</label>
        <div class="modal-actions">
          <button class="btn" @click="showEdit=false">取消</button>
          <button class="btn btn-primary" :disabled="saving" @click="submit">{{ saving ? '提交中...' : '确认' }}</button>
        </div>
      </div>
    </div>

    <!-- JSON 导入弹窗 -->
    <div v-if="showImport" class="modal-mask" @click.self="showImport=false">
      <div class="modal modal-lg">
        <div class="modal-header"><h2>JSON 导入密钥</h2><button class="modal-close" @click="showImport=false">×</button></div>
        <p class="hint">支持格式：<code>{ "keys": [ {id, appId, appSecret, authUaKeys} ] }</code>，或密钥数组。与 CF 环境变量 <code>APP_KEY_POOL</code> 同构。</p>
        <textarea v-model="importText" class="json-area" placeholder='{"keys":[{"id":"k1","appId":"...","appSecret":"...","authUaKeys":[]}]}'></textarea>
        <label class="chk"><input type="checkbox" v-model="replaceAll" /> 覆盖导入（先清空现有全部密钥）</label>
        <p v-if="importError" class="err">{{ importError }}</p>
        <div class="modal-actions">
          <button class="btn" @click="showImport=false">取消</button>
          <button class="btn btn-primary" :disabled="importing" @click="doImport">{{ importing ? '导入中...' : '确认导入' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { reactive, ref, onMounted } from 'vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'KeyPool',
  setup() {
    const items = ref([])
    const states = ref([])
    const uaKeys = ref([])
    const groups = ['search_anime', 'search_episodes', 'bangumi', 'comment', 'match']
    const msg = ref('')
    const updatedAt = ref('')
    const showEdit = ref(false)
    const saving = ref(false)
    const editId = ref(null)
    const form = reactive({ key_id: '', app_id: '', app_secret: '', auth_ua_keys: [], forward_ua: '', remark: '', enabled: true })
    // JSON 导入/导出状态
    const showImport = ref(false)
    const importText = ref('')
    const replaceAll = ref(false)
    const importing = ref(false)
    const importError = ref('')

    const load = async () => {
      msg.value = ''
      try {
        const [k, s, u] = await Promise.all([
          apiV2('/key-pool'),
          apiV2('/key-pool/states'),
          apiV2('/key-pool/ua-keys'),
        ])
        items.value = (k.data && k.data.items) || []
        states.value = (s.data && s.data.items) || []
        uaKeys.value = (u.data && u.data.items) || []
        updatedAt.value = new Date().toLocaleTimeString()
      } catch (e) { msg.value = e.message }
    }

    const resetForm = () => {
      form.key_id = ''; form.app_id = ''; form.app_secret = ''
      form.auth_ua_keys = []; form.forward_ua = ''; form.remark = ''; form.enabled = true
    }
    const openCreate = () => { editId.value = null; resetForm(); showEdit.value = true }
    const openEdit = (r) => {
      editId.value = r.id
      form.key_id = r.key_id
      form.app_id = r.app_id
      form.app_secret = ''  // 留空表示不修改
      form.auth_ua_keys = [...(r.auth_ua_keys || [])]
      form.forward_ua = r.forward_ua || ''
      form.remark = r.remark || ''
      form.enabled = r.enabled
      showEdit.value = true
    }

    const submit = async () => {
      if (!form.key_id) { msg.value = '请填写 key_id'; return }
      if (!editId.value && (!form.app_id || !form.app_secret)) { msg.value = '请填写 App ID 和 App Secret'; return }
      saving.value = true
      try {
        if (editId.value) {
          const body = { app_id: form.app_id, auth_ua_keys: form.auth_ua_keys, forward_ua: form.forward_ua, remark: form.remark, enabled: form.enabled }
          if (form.app_secret) body.app_secret = form.app_secret
          const res = await apiV2(`/key-pool/${editId.value}`, { method: 'PUT', body })
          msg.value = res.message || '更新成功'
        } else {
          const res = await apiV2('/key-pool', { method: 'POST', body: { ...form } })
          msg.value = res.message || '创建成功'
        }
        showEdit.value = false
        load()
      } catch (e) { msg.value = e.message } finally { saving.value = false }
    }
    const toggle = async (r) => {
      try { await apiV2(`/key-pool/${r.id}`, { method: 'PUT', body: { enabled: !r.enabled } }); load() }
      catch (e) { msg.value = e.message }
    }
    const del = async (id) => {
      if (!confirm('确认删除该密钥？')) return
      try { const res = await apiV2(`/key-pool/${id}`, { method: 'DELETE' }); msg.value = res.message || '已删除'; load() }
      catch (e) { msg.value = e.message }
    }
    const resync = async () => {
      try { const res = await apiV2('/key-pool/resync', { method: 'POST' }); msg.value = res.message || '已下发' }
      catch (e) { msg.value = e.message }
    }

    // JSON 导入
    const openImport = () => { importText.value = ''; replaceAll.value = false; importError.value = ''; showImport.value = true }
    const doImport = async () => {
      importError.value = ''
      let parsed
      try { parsed = JSON.parse(importText.value) }
      catch (e) { importError.value = 'JSON 解析失败：' + e.message; return }
      importing.value = true
      try {
        const res = await apiV2('/key-pool/import', { method: 'POST', body: { data: parsed, replace_all: replaceAll.value } })
        msg.value = res.message || '导入成功'
        showImport.value = false
        load()
      } catch (e) { importError.value = e.message } finally { importing.value = false }
    }
    // 导出 JSON（下载文件）
    const exportJson = async () => {
      try {
        const res = await apiV2('/key-pool/export')
        const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `app_key_pool_${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(a.href)
      } catch (e) { msg.value = e.message }
    }

    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')
    const fmtTs = (t) => (t ? new Date(t * 1000).toLocaleString() : '')

    onMounted(load)
    return { items, states, uaKeys, groups, msg, updatedAt, showEdit, saving, editId, form,
      showImport, importText, replaceAll, importing, importError,
      load, openCreate, openEdit, submit, toggle, del, resync,
      openImport, doImport, exportJson, fmt, fmtTs }
  }
}
</script>

<style scoped>
.page { padding: 24px; }
.page-title { font-size: 22px; margin-bottom: 20px; color: #333; }
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; align-items: center; }
.input { padding: 8px 12px; border: 1px solid #d9d9d9; border-radius: 6px; }
.btn { padding: 8px 16px; border: 1px solid #d9d9d9; background: #fff; border-radius: 6px; cursor: pointer; }
.btn:disabled { opacity: .6; cursor: not-allowed; }
.btn-primary { background: #1677ff; color: #fff; border-color: #1677ff; }
.muted { color: #999; font-size: 12px; }
.tip { background: #e6f4ff; border: 1px solid #91caff; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; color: #0958d9; }
.panel { background: #fff; border-radius: 10px; padding: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); margin-bottom: 24px; }
.panel-title { font-size: 16px; margin-bottom: 14px; color: #333; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
.data-table th { color: #888; font-weight: 500; }
.key { font-family: monospace; font-size: 12px; }
.msg { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.actions { display: flex; gap: 8px; }
.link { background: none; border: none; color: #1677ff; cursor: pointer; font-size: 13px; }
.link.danger { color: #cf1322; }
.empty { text-align: center; color: #999; padding: 20px; }
.badge { display: inline-block; padding: 2px 8px; margin: 2px; border-radius: 10px; font-size: 11px; background: #f0f0f0; color: #555; }
.badge-pool { background: #e6f4ff; color: #0958d9; }
.badge-ok { background: #f6ffed; color: #389e0d; }
.badge-limited { background: #fff1f0; color: #cf1322; }
.state-block { margin-bottom: 18px; }
.state-head { display: flex; gap: 12px; align-items: baseline; margin-bottom: 8px; }
.ua-checks { display: flex; flex-direction: column; gap: 6px; max-height: 180px; overflow-y: auto; border: 1px solid #f0f0f0; border-radius: 6px; padding: 10px; }
.ua-check { font-size: 13px; color: #333; display: flex; align-items: center; gap: 6px; }
.chk { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #555; margin-bottom: 14px; }
.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { width: 460px; max-width: 92vw; background: #fff; border-radius: 12px; padding: 20px; }
.modal-lg { width: 600px; }
.json-area { width: 100%; height: 240px; font-family: monospace; font-size: 12px; padding: 10px; border: 1px solid #d9d9d9; border-radius: 6px; resize: vertical; box-sizing: border-box; }
.hint { color: #666; font-size: 12px; margin-bottom: 10px; }
.hint code { background: #f0f0f0; padding: 1px 5px; border-radius: 3px; font-size: 11px; }
.err { color: #cf1322; font-size: 13px; margin-top: 8px; }
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.modal-close { border: none; background: none; font-size: 22px; color: #999; cursor: pointer; }
.form-item { margin-bottom: 14px; }
.form-item label { display: block; margin-bottom: 6px; color: #555; font-size: 13px; }
.input.full { width: 100%; box-sizing: border-box; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
</style>

