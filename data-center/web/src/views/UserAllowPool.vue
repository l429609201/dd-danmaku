<template>
  <div class="panel" style="margin-top: 20px;">
    <div class="panel-head">
      <h2 class="panel-title">用户允许名单池</h2>
      <button class="btn btn-primary" @click="openCreate">新增用户组</button>
    </div>
    <p class="hint">
      按客户端用户名（请求头 <code>X-Ddd-User</code> 的值）过滤访问。
      在「UA 限流规则」编辑里为某个 UA 选择本组，即对该 UA 启用用户名校验；<strong>不选则不校验</strong>。
      校验顺序：实例 ID 校验 → 用户名校验 → 签名校验。
    </p>
    <div v-if="msg" class="tip">{{ msg }}</div>

    <table class="data-table">
      <thead><tr>
        <th>组ID</th><th>用户数</th><th>用户名（前若干个）</th><th>实例校验</th><th>备注</th><th>启用</th><th>操作</th>
      </tr></thead>
      <tbody>
        <tr v-for="r in items" :key="r.id">
          <td class="key">{{ r.group_id }}</td>
          <td>{{ r.user_count }}</td>
          <td class="msg">{{ previewUsers(r.users) }}</td>
          <td>{{ r.brand_mark ? '✅ ' + r.brand_mark : '—' }}</td>
          <td>{{ r.remark || '—' }}</td>
          <td>{{ r.enabled ? '是' : '否' }}</td>
          <td class="actions">
            <button class="link" @click="openEdit(r)">编辑</button>
            <button class="link" @click="toggle(r)">{{ r.enabled ? '停用' : '启用' }}</button>
            <button class="link danger" @click="del(r.id)">删除</button>
          </td>
        </tr>
        <tr v-if="!items.length"><td colspan="7" class="empty">暂无用户组</td></tr>
      </tbody>
    </table>

    <!-- 新增/编辑弹窗 -->
    <div v-if="showEdit" class="modal-mask" @click.self="showEdit=false">
      <div class="modal">
        <div class="modal-header">
          <h2>{{ editId ? '编辑' : '新增' }}用户组</h2>
          <button class="modal-close" @click="showEdit=false">×</button>
        </div>
        <div class="form-item">
          <label>组ID（唯一标识）</label>
          <input v-model="form.group_id" class="input full" :disabled="!!editId" />
        </div>
        <div class="form-item">
          <label>允许的用户名（每行一个，也可用逗号分隔）</label>
          <textarea v-model="form.usersText" class="input full" rows="8"
                    placeholder="user-a&#10;user-b&#10;user-c"></textarea>
          <p class="hint">
            当前 {{ parsedCount }} 个。<strong>精确匹配</strong>，区分大小写。
            留空表示该组不允许任何用户通过（等于封禁绑定此组的 UA）。
          </p>
        </div>
        <div class="form-item">
          <label>实例 ID 校验（两项均填才启用；对 X-Ddd-Instance 做 XOR 反解归属识别）</label>
          <input v-model="form.brand_mark" class="input full" placeholder="品牌标记，如 misaka10876" />
          <input v-model="form.obf_key" class="input full" style="margin-top:8px"
                 placeholder="混淆密钥，如 misaka_danmu_server" />
          <p class="hint">仅作归属识别，密钥随弹幕库源码公开，<strong>不能替代签名验证</strong>。留空则不校验实例。</p>
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
import { computed, reactive, ref, onMounted } from 'vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'UserAllowPool',
  setup() {
    const items = ref([])
    const msg = ref('')
    const showEdit = ref(false)
    const saving = ref(false)
    const editId = ref(null)
    // usersText 为文本域原文，提交时切分为数组（后端也会再规范化一次）
    const form = reactive({ group_id: '', usersText: '', brand_mark: '', obf_key: '', remark: '', enabled: true })

    // 把文本域内容切成用户名数组：支持换行与逗号混用，去空去重
    const parseUsers = (text) => {
      const raw = String(text || '').replace(/,/g, '\n').split('\n')
      const out = []
      const seen = new Set()
      for (const item of raw) {
        const v = item.trim()
        if (!v || seen.has(v)) continue
        seen.add(v)
        out.push(v)
      }
      return out
    }
    const parsedCount = computed(() => parseUsers(form.usersText).length)

    // 列表里只展示前 5 个，避免长名单撑破表格
    const previewUsers = (users) => {
      const arr = Array.isArray(users) ? users : []
      if (!arr.length) return '—'
      const head = arr.slice(0, 5).join(', ')
      return arr.length > 5 ? `${head} …(共 ${arr.length})` : head
    }

    const load = async () => {
      try {
        const s = await apiV2('/user-allow-pool')
        items.value = (s.data && s.data.items) || []
      } catch (e) { msg.value = e.message }
    }

    const resetForm = () => {
      form.group_id = ''; form.usersText = ''
      form.brand_mark = ''; form.obf_key = ''
      form.remark = ''; form.enabled = true
    }
    const openCreate = () => { editId.value = null; resetForm(); showEdit.value = true }
    const openEdit = (r) => {
      editId.value = r.id
      form.group_id = r.group_id
      form.usersText = (Array.isArray(r.users) ? r.users : []).join('\n')
      form.brand_mark = r.brand_mark || ''
      form.obf_key = r.obf_key || ''
      form.remark = r.remark || ''
      form.enabled = r.enabled
      showEdit.value = true
    }

    const submit = async () => {
      if (!form.group_id) { msg.value = '请填写组ID'; return }
      saving.value = true
      try {
        const users = parseUsers(form.usersText)
        if (editId.value) {
          const body = { users,
            brand_mark: form.brand_mark || undefined,
            obf_key: form.obf_key || undefined,
            remark: form.remark, enabled: form.enabled }
          const res = await apiV2(`/user-allow-pool/${editId.value}`, { method: 'PUT', body })
          msg.value = res.message || '更新成功'
        } else {
          const body = { group_id: form.group_id, users,
            brand_mark: form.brand_mark || undefined,
            obf_key: form.obf_key || undefined,
            remark: form.remark, enabled: form.enabled }
          const res = await apiV2('/user-allow-pool', { method: 'POST', body })
          msg.value = res.message || '创建成功'
        }
        showEdit.value = false
        load()
      } catch (e) { msg.value = e.message }
      finally { saving.value = false }
    }
    const toggle = async (r) => {
      try { await apiV2(`/user-allow-pool/${r.id}`, { method: 'PUT', body: { enabled: !r.enabled } }); load() }
      catch (e) { msg.value = e.message }
    }
    const del = async (id) => {
      if (!confirm('确认删除该用户组？绑定它的 UA 将不再校验用户名。')) return
      try { const res = await apiV2(`/user-allow-pool/${id}`, { method: 'DELETE' }); msg.value = res.message || '已删除'; load() }
      catch (e) { msg.value = e.message }
    }

    onMounted(load)
    return { items, msg, showEdit, saving, editId, form, parsedCount,
      previewUsers, openCreate, openEdit, submit, toggle, del }
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
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
.data-table th { color: #888; font-weight: 500; }
.key { font-family: monospace; font-size: 12px; }
.msg { color: #555; font-size: 12px; max-width: 320px; word-break: break-all; }
.actions { display: flex; gap: 8px; }
.link { background: none; border: none; color: #1677ff; cursor: pointer; font-size: 13px; }
.link.danger { color: #cf1322; }
.empty { text-align: center; color: #999; padding: 20px; }
.btn { padding: 8px 16px; border: 1px solid #d9d9d9; background: #fff; border-radius: 6px; cursor: pointer; }
.btn:disabled { opacity: .6; cursor: not-allowed; }
.btn-primary { background: #1677ff; color: #fff; border-color: #1677ff; }
.input { padding: 8px 12px; border: 1px solid #d9d9d9; border-radius: 6px; font-family: inherit; font-size: 13px; }
.input.full { width: 100%; box-sizing: border-box; }
textarea.input { resize: vertical; font-family: monospace; }
.chk { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #555; margin-bottom: 14px; }
.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { width: 520px; max-width: 92vw; background: #fff; border-radius: 12px; padding: 20px; }
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.modal-close { border: none; background: none; font-size: 22px; color: #999; cursor: pointer; }
.form-item { margin-bottom: 14px; }
.form-item label { display: block; margin-bottom: 6px; color: #555; font-size: 13px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
</style>
