<template>
  <div class="panel" style="margin-top: 20px;">
    <div class="panel-head">
      <h2 class="panel-title">签名密钥池</h2>
      <div class="panel-actions">
        <button class="btn" @click="openCreate">新增密钥组</button>
      </div>
    </div>
    <p class="hint">
      客户端请求签名验证密钥，按 UA 分组。每组 secret 需与<strong>内置该密钥、独立编译的 ede.js/sign.wasm</strong> 一致。
      空授权 UA=公共组（所有需验签 UA 通用）；指定 UA=专属组。留空则该 UA 不受此组约束。
    </p>
    <p v-if="msg" class="msg">{{ msg }}</p>

    <table class="data-table">
      <thead><tr>
        <th>组ID</th><th>密钥</th><th>授权UA</th><th>启用</th><th>操作</th>
      </tr></thead>
      <tbody>
        <tr v-for="r in items" :key="r.id">
          <td class="key">{{ r.group_id }}</td>
          <td class="msg">{{ r.secret }}</td>
          <td>
            <span v-if="!r.auth_ua_keys || !r.auth_ua_keys.length" class="badge badge-pool">公共组</span>
            <span v-else v-for="u in r.auth_ua_keys" :key="u" class="badge">{{ u }}</span>
          </td>
          <td>{{ r.enabled ? '是' : '否' }}</td>
          <td class="actions">
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
        <div class="form-item">
          <label>授权 UA（勾选=专属组；全不选=公共组）</label>
          <div class="ua-list">
            <label v-for="u in uaKeys" :key="u.ua_key" class="ua-check">
              <input type="checkbox" :value="u.ua_key" v-model="form.auth_ua_keys" />
              {{ u.ua_key }} <span class="muted">{{ u.user_agent }}</span>
            </label>
          </div>
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
    const uaKeys = ref([])
    const msg = ref('')
    const showEdit = ref(false)
    const saving = ref(false)
    const editId = ref(null)
    const secretShow = ref(false)
    const form = reactive({ group_id: '', secret: '', auth_ua_keys: [], remark: '', enabled: true })

    const load = async () => {
      try {
        const [s, u] = await Promise.all([
          apiV2('/sign-key-pool'),
          apiV2('/key-pool/ua-keys'),
        ])
        items.value = (s.data && s.data.items) || []
        uaKeys.value = (u.data && u.data.items) || []
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

    const resetForm = () => {
      form.group_id = ''; form.secret = ''; form.auth_ua_keys = []
      form.remark = ''; form.enabled = true; secretShow.value = false
    }
    const openCreate = () => { editId.value = null; resetForm(); showEdit.value = true }
    const openEdit = (r) => {
      editId.value = r.id
      form.group_id = r.group_id
      form.secret = ''  // 留空表示不修改
      form.auth_ua_keys = [...(r.auth_ua_keys || [])]
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
          const body = { auth_ua_keys: form.auth_ua_keys, remark: form.remark, enabled: form.enabled }
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
    return { items, uaKeys, msg, showEdit, saving, editId, form, secretShow,
      openCreate, openEdit, submit, toggle, del, genSecret, copySecret }
  }
}
</script>
