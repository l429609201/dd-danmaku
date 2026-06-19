<template>
  <div class="page">
    <h1 class="page-title">用户与 Token</h1>
    <div v-if="msg" class="tip">{{ msg }}</div>

    <!-- 用户管理 -->
    <div class="panel">
      <div class="panel-head">
        <h2 class="panel-title">用户</h2>
        <button class="btn btn-primary" @click="openCreate">新增用户</button>
      </div>
      <table class="data-table">
        <thead><tr><th>用户名</th><th>显示名</th><th>角色</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>{{ u.username }}</td>
            <td>{{ u.display_name || '—' }}</td>
            <td>{{ u.role }}</td>
            <td>{{ u.is_active ? '启用' : '禁用' }}</td>
            <td>{{ fmt(u.last_login_at) }}</td>
            <td class="actions">
              <button class="link" @click="toggleActive(u)">{{ u.is_active ? '禁用' : '启用' }}</button>
              <button class="link danger" @click="del(u)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Token 管理 -->
    <div class="panel">
      <div class="panel-head">
        <h2 class="panel-title">API Token</h2>
        <button class="btn btn-primary" @click="createToken">新建 Token</button>
      </div>
      <div v-if="newToken" class="token-box">明文 Token（仅显示一次）：<code>{{ newToken }}</code></div>
      <table class="data-table">
        <thead><tr><th>名称</th><th>摘要</th><th>状态</th><th>最近使用</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="t in tokens" :key="t.id">
            <td>{{ t.name }}</td>
            <td class="key">{{ t.token_digest }}</td>
            <td>{{ t.is_active ? '启用' : '禁用' }}</td>
            <td>{{ fmt(t.last_used_at) }}</td>
            <td><button class="link danger" @click="delToken(t)">删除</button></td>
          </tr>
          <tr v-if="!tokens.length"><td colspan="5" class="empty">暂无 Token</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 新增用户弹窗 -->
    <div v-if="creating" class="drawer-mask" @click.self="creating=false">
      <div class="modal">
        <h2>新增用户</h2>
        <label class="field">用户名<input v-model="form.username" class="input" /></label>
        <label class="field">密码<input v-model="form.password" type="password" class="input" /></label>
        <label class="field">显示名<input v-model="form.display_name" class="input" /></label>
        <label class="field">角色
          <select v-model="form.role" class="input">
            <option value="viewer">viewer</option>
            <option value="operator">operator</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <div class="modal-actions">
          <button class="btn" @click="creating=false">取消</button>
          <button class="btn btn-primary" @click="saveCreate">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'Users',
  setup() {
    const users = ref([])
    const tokens = ref([])
    const msg = ref('')
    const creating = ref(false)
    const newToken = ref('')
    const form = ref({ username: '', password: '', display_name: '', role: 'viewer' })

    const load = async () => {
      msg.value = ''
      try {
        const u = await apiV2('/users')
        users.value = u.data || []
        const t = await apiV2('/users/api-tokens/list')
        tokens.value = t.data || []
      } catch (e) { msg.value = e.message }
    }

    const openCreate = () => {
      form.value = { username: '', password: '', display_name: '', role: 'viewer' }
      creating.value = true
    }

    const saveCreate = async () => {
      try {
        await apiV2('/users', { method: 'POST', body: form.value })
        creating.value = false
        load()
      } catch (e) { msg.value = e.message }
    }

    const toggleActive = async (u) => {
      try { await apiV2(`/users/${u.id}`, { method: 'PUT', body: { is_active: !u.is_active } }); load() }
      catch (e) { msg.value = e.message }
    }

    const del = async (u) => {
      if (!confirm(`确认删除用户 ${u.username}？`)) return
      try { await apiV2(`/users/${u.id}`, { method: 'DELETE' }); load() }
      catch (e) { msg.value = e.message }
    }

    const createToken = async () => {
      const name = prompt('Token 名称：')
      if (!name) return
      try {
        const res = await apiV2('/users/api-tokens', { method: 'POST', body: { name, scopes: [] } })
        newToken.value = res.data.token
        load()
      } catch (e) { msg.value = e.message }
    }

    const delToken = async (t) => {
      if (!confirm(`确认删除 Token ${t.name}？`)) return
      try { await apiV2(`/users/api-tokens/${t.id}`, { method: 'DELETE' }); load() }
      catch (e) { msg.value = e.message }
    }

    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')
    onMounted(load)
    return { users, tokens, msg, creating, newToken, form,
      openCreate, saveCreate, toggleActive, del, createToken, delToken, fmt }
  }
}
</script>

<style scoped>
.page { padding: 24px; }
.page-title { font-size: 22px; margin-bottom: 20px; color: #333; }
.tip { background: #fff1f0; border: 1px solid #ffccc7; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; color: #cf1322; }
.panel { background: #fff; border-radius: 10px; padding: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); margin-bottom: 20px; }
.panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.panel-title { font-size: 16px; color: #333; }
.btn { padding: 8px 16px; border: 1px solid #d9d9d9; background: #fff; border-radius: 6px; cursor: pointer; }
.btn-primary { background: #1677ff; color: #fff; border-color: #1677ff; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
.data-table th { color: #888; font-weight: 500; }
.actions { display: flex; gap: 8px; }
.link { background: none; border: none; color: #1677ff; cursor: pointer; font-size: 13px; }
.link.danger { color: #cf1322; }
.key { font-family: monospace; font-size: 12px; }
.empty { text-align: center; color: #999; padding: 20px; }
.token-box { background: #f6ffed; border: 1px solid #b7eb8f; padding: 10px 14px; border-radius: 6px; margin-bottom: 14px; font-size: 13px; }
.drawer-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: #fff; border-radius: 10px; padding: 24px; width: 420px; max-width: 90vw; }
.modal h2 { font-size: 18px; margin-bottom: 16px; }
.field { display: block; margin-bottom: 14px; font-size: 13px; color: #555; }
.field .input { display: block; width: 100%; margin-top: 6px; box-sizing: border-box; }
.modal-actions { display: flex; justify-content: flex-end; gap: 12px; }
</style>