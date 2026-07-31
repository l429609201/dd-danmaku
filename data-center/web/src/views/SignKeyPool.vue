<template>
  <div class="panel" style="margin-top: 20px;">
    <div class="panel-head">
      <h2 class="panel-title">签名密钥池</h2>
      <button class="btn btn-primary" @click="openCreate">新增密钥组</button>
    </div>
    <p class="hint">
      客户端请求签名验证密钥。每组 secret 需与<strong>内置该密钥、独立编译的 ede.js/sign.wasm</strong> 一致。
      在「UA 限流规则」编辑里为某个 UA 选择本组，即对该 UA 启用签名验证。
    </p>
    <div v-if="msg" class="tip">{{ msg }}</div>

    <table class="data-table">
      <thead><tr>
        <th>组ID</th><th>密钥</th><th>备注</th><th>启用</th><th>操作</th>
      </tr></thead>
      <tbody>
        <tr v-for="r in items" :key="r.id">
          <td class="key">{{ r.group_id }}</td>
          <td class="msg">{{ r.secret }}</td>
          <td>{{ r.remark || '—' }}</td>
          <td>{{ r.enabled ? '是' : '否' }}</td>
          <td class="actions">
            <button class="link" @click="copyRowSecret(r.id)">复制密钥</button>
            <button class="link" @click="openEdit(r)">编辑</button>
            <button class="link" @click="toggle(r)">{{ r.enabled ? '停用' : '启用' }}</button>
            <button class="link danger" @click="del(r.id)">删除</button>
          </td>
        </tr>
        <tr v-if="!items.length"><td colspan="5" class="empty">暂无签名密钥组</td></tr>
      </tbody>
    </table>

    <!-- 新增/编辑弹窗 -->
    <div v-if="showEdit" class="modal-mask" @click.self="showEdit=false">
      <div class="modal">
        <div class="modal-header"><h2>{{ editId ? '编辑' : '新增' }}签名密钥组</h2><button class="modal-close" @click="showEdit=false">×</button></div>
        <div class="form-item"><label>组ID（唯一标识）</label><input v-model="form.group_id" class="input full" :disabled="!!editId" /></div>
        <div class="form-item">
          <label>签名密钥 secret{{ editId ? '（留空不修改）' : '' }}</label>
          <div class="token-row">
            <input v-model="form.secret" class="input full" :type="secretShow ? 'text' : 'password'" placeholder="与对应 wasm 内置值一致" />
            <button class="btn" @click="genSecret">随机生成</button>
            <button class="btn" @click="secretShow = !secretShow" :disabled="!form.secret">{{ secretShow ? '隐藏' : '显示' }}</button>
            <button class="btn" @click="copySecret" :disabled="!form.secret">复制</button>
          </div>
          <p class="hint" v-if="form.secret">⚠️ 随机生成的密钥需<strong>填入对应 wasm-sign/config.ts 重新编译部署</strong>，两端一致才能验签成功。</p>
        </div>
        <div class="form-item"><label>备注</label><input v-model="form.remark" class="input full" /></div>
        <label class="chk"><input type="checkbox" v-model="form.enabled" /> 启用</label>
        <div class="modal-actions">
          <button class="btn" @click="showEdit=false">取消</button>
          <button class="btn btn-primary" :disabled="saving" @click="submit">{{ saving ? '提交中...' : '确认' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { reactive, ref, onMounted } from 'vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'SignKeyPool',
  setup() {
    const items = ref([])
    const msg = ref('')
    const showEdit = ref(false)
    const saving = ref(false)
    const editId = ref(null)
    const secretShow = ref(false)
    const form = reactive({ group_id: '', secret: '', remark: '', enabled: true })

    const load = async () => {
      try {
        const s = await apiV2('/sign-key-pool')
        items.value = (s.data && s.data.items) || []
      } catch (e) { msg.value = e.message }
    }

    const genSecret = async () => {
      try {
        const res = await apiV2('/sign-key-pool/gen')
        form.secret = (res.data && res.data.secret) || ''
        secretShow.value = true
        msg.value = '已生成随机密钥，请填入对应 wasm 的 config.ts 重新编译'
      } catch (e) { msg.value = e.message }
    }
    const copySecret = async () => {
      try { await navigator.clipboard.writeText(form.secret); msg.value = '已复制' }
      catch (e) { msg.value = '复制失败，请手动复制' }
    }
    // 复制列表某行的明文密钥：先向后端取明文（列表返回的是脱敏值），再写剪贴板
    const copyRowSecret = async (id) => {
      try {
        const res = await apiV2(`/sign-key-pool/${id}/secret`)
        const secret = (res.data && res.data.secret) || ''
        if (!secret) { msg.value = '该密钥为空'; return }
        await navigator.clipboard.writeText(secret)
        msg.value = '已复制明文密钥'
      } catch (e) { msg.value = '复制失败：' + (e.message || e) }
    }

    const resetForm = () => {
      form.group_id = ''; form.secret = ''
      form.remark = ''; form.enabled = true; secretShow.value = false
    }
    const openCreate = () => { editId.value = null; resetForm(); showEdit.value = true }
    const openEdit = (r) => {
      editId.value = r.id
      form.group_id = r.group_id
      form.secret = ''  // 留空表示不修改
      form.remark = r.remark || ''
      form.enabled = r.enabled
      secretShow.value = false
      showEdit.value = true
    }

    const submit = async () => {
      if (!form.group_id) { msg.value = '请填写组ID'; return }
      if (!editId.value && !form.secret) { msg.value = '请填写 secret'; return }
      saving.value = true
      try {
        if (editId.value) {
          const body = { remark: form.remark, enabled: form.enabled }
          if (form.secret) body.secret = form.secret
          const res = await apiV2(`/sign-key-pool/${editId.value}`, { method: 'PUT', body })
          msg.value = res.message || '更新成功'
        } else {
          const res = await apiV2('/sign-key-pool', { method: 'POST', body: { ...form } })
          msg.value = res.message || '创建成功'
        }
        showEdit.value = false
        load()
      } catch (e) { msg.value = e.message }
      finally { saving.value = false }
    }
    const toggle = async (r) => {
      try { await apiV2(`/sign-key-pool/${r.id}`, { method: 'PUT', body: { enabled: !r.enabled } }); load() }
      catch (e) { msg.value = e.message }
    }
    const del = async (id) => {
      if (!confirm('确认删除该签名密钥组？')) return
      try { const res = await apiV2(`/sign-key-pool/${id}`, { method: 'DELETE' }); msg.value = res.message || '已删除'; load() }
      catch (e) { msg.value = e.message }
    }

    onMounted(load)
    return { items, msg, showEdit, saving, editId, form, secretShow,
      openCreate, openEdit, submit, toggle, del, genSecret, copySecret, copyRowSecret }
  }
}
</script>

<style scoped>
.panel { background: #fff; border-radius: 10px; padding: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); margin-bottom: 24px; }
.panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.panel-title { font-size: 16px; color: #333; }
.hint { color: #666; font-size: 12px; margin-bottom: 10px; }
.hint code { background: #f0f0f0; padding: 1px 5px; border-radius: 3px; font-size: 11px; }
.tip { background: #e6f4ff; border: 1px solid #91caff; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; color: #0958d9; font-size: 13px; }
.muted { color: #999; font-size: 12px; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
.data-table th { color: #888; font-weight: 500; }
.key { font-family: monospace; font-size: 12px; }
.actions { display: flex; gap: 8px; }
.link { background: none; border: none; color: #1677ff; cursor: pointer; font-size: 13px; }
.link.danger { color: #cf1322; }
.empty { text-align: center; color: #999; padding: 20px; }
.btn { padding: 8px 16px; border: 1px solid #d9d9d9; background: #fff; border-radius: 6px; cursor: pointer; }
.btn:disabled { opacity: .6; cursor: not-allowed; }
.btn-primary { background: #1677ff; color: #fff; border-color: #1677ff; }
.input { padding: 8px 12px; border: 1px solid #d9d9d9; border-radius: 6px; }
.input.full { width: 100%; box-sizing: border-box; }
.chk { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #555; margin-bottom: 14px; }
.token-row { display: flex; gap: 8px; align-items: center; }
.token-row .input.full { flex: 1; }
.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { width: 460px; max-width: 92vw; background: #fff; border-radius: 12px; padding: 20px; }
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.modal-close { border: none; background: none; font-size: 22px; color: #999; cursor: pointer; }
.form-item { margin-bottom: 14px; }
.form-item label { display: block; margin-bottom: 6px; color: #555; font-size: 13px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
</style>
