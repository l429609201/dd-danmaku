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
      <!-- 使用后端分页契约，避免只显示默认首页导致其余用户无法管理。 -->
      <div class="panel-head">
        <span>共 {{ total }} 位用户；第 {{ page }} / {{ totalPages }} 页</span>
        <div>
          <select v-model.number="pageSize" @change="changePage(1)"><option :value="20">20 条</option><option :value="50">50 条</option><option :value="100">100 条</option></select>
          <button class="btn" :disabled="loading || page <= 1" @click="changePage(page - 1)">上一页</button>
          <button class="btn" :disabled="loading || page >= totalPages" @click="changePage(page + 1)">下一页</button>
        </div>
      </div>
    </div>

    <!-- Token 管理 -->
    <div class="panel">
      <div class="panel-head">
        <h2 class="panel-title">API Token</h2>
        <div><select v-model="tokenUserId" @change="loadTokens"><option v-for="u in users" :key="u.id" :value="u.id">{{ u.username }}</option></select> <button class="btn btn-primary" :disabled="!tokenUserId" @click="createToken">新建 Token</button></div>
      </div>
      <div v-if="newToken" class="token-box">明文 Token（仅显示一次）：<code>{{ newToken }}</code></div>
      <table class="data-table">
        <thead><tr><th>名称</th><th>摘要</th><th>状态</th><th>最近使用</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="t in tokens" :key="t.id">
            <td>{{ t.name }}</td>
            <td class="key">{{ t.token ? `${t.token.slice(0, 7)}…` : '—' }}</td>
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
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'Users',
  setup() {
    const users = ref([])
    const tokens = ref([])
    const tokenUserId = ref(null)
    const msg = ref('')
    const creating = ref(false)
    const newToken = ref('')
    const form = ref({ username: '', password: '', display_name: '', role: 'viewer' })

    const total = ref(0)
    const page = ref(1)
    const pageSize = ref(20)
    const loading = ref(false)
    const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
    let userRequest = 0
    let tokenRequest = 0

    // 用户切换立即擦除明文及旧列表，迟到响应不得覆盖当前用户的数据。
    watch(tokenUserId, () => {
      newToken.value = ''
      tokens.value = []
      tokenRequest++
    }, { flush: 'sync' })

    const load = async () => {
      const requestId = ++userRequest
      loading.value = true
      msg.value = ''
      try {
        const u = await apiV2(`/users?page=${page.value}&page_size=${pageSize.value}`)
        if (requestId !== userRequest) return
        total.value = u.total
        if (page.value > totalPages.value) {
          // 删除末页最后一个用户时回到仍存在的页，避免列表永久空白。
          page.value = totalPages.value
          return await load()
        }
        users.value = u.users || []
        if (!users.value.some(user => user.id === tokenUserId.value)) {
          tokenUserId.value = users.value[0]?.id ?? null
        }
        await loadTokens()
      } catch (e) { if (requestId === userRequest) msg.value = e.message }
      finally { if (requestId === userRequest) loading.value = false }
    }

    const changePage = async (value) => {
      page.value = Math.max(1, Math.min(value, totalPages.value))
      newToken.value = ''
      await load()
    }

    const loadTokens = async () => {
      const userId = tokenUserId.value
      const requestId = ++tokenRequest
      try {
        const rows = userId ? await apiV2(`/users/${userId}/tokens`) : []
        if (requestId === tokenRequest && userId === tokenUserId.value) tokens.value = rows
      } catch (e) {
        if (requestId === tokenRequest && userId === tokenUserId.value) { msg.value = e.message; tokens.value = [] }
      }
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
      const userId = tokenUserId.value
      if (!userId) return
      const name = prompt('Token 名称：')
      if (!name) return
      newToken.value = ''
      const requestId = tokenRequest
      try {
        const res = await apiV2(`/users/${userId}/tokens`, { method: 'POST', body: { name, scopes: [] } })
        // 创建过程中切换用户或离开页面时，不再展示旧用户的敏感明文。
        if (userId !== tokenUserId.value || requestId !== tokenRequest) return
        newToken.value = res.token.token
        await loadTokens()
      } catch (e) { if (userId === tokenUserId.value) msg.value = e.message }
    }

    const delToken = async (t) => {
      const userId = tokenUserId.value
      if (!userId || !confirm(`确认删除 Token ${t.name}？`)) return
      newToken.value = ''
      try {
        await apiV2(`/users/${userId}/tokens/${t.id}`, { method: 'DELETE' })
        if (userId === tokenUserId.value) await loadTokens()
      } catch (e) { if (userId === tokenUserId.value) msg.value = e.message }
    }

    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')
    onMounted(load)
    onUnmounted(() => {
      // 离开页面即擦除明文，并让所有在途响应失效。
      newToken.value = ''
      userRequest++
      tokenRequest++
    })
    return { users, tokens, tokenUserId, loadTokens, msg, creating, newToken, form,
      total, page, pageSize, totalPages, loading, changePage,
      openCreate, saveCreate, toggleActive, del, createToken, delToken, fmt }
  }
}
</script>

<style scoped>
.page { padding: 24px; }
.page-title { font-size: 22px; margin-bottom: 20px; color: var(--color-text); }
.tip { background: color-mix(in srgb, var(--color-danger) 8%, transparent); border: 1px solid color-mix(in srgb, var(--color-danger) 25%, transparent); padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; color: var(--color-danger); }
.panel { background: var(--color-bg); border-radius: 10px; padding: 18px; box-shadow: var(--shadow-sm); margin-bottom: 20px; border: 1px solid var(--color-border-light); }
.panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.panel-title { font-size: 16px; color: var(--color-text); }
.btn { padding: 8px 16px; border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text); border-radius: 6px; cursor: pointer; }
.btn-primary { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--color-border-lighter); font-size: 13px; }
.data-table th { color: var(--color-text-secondary); font-weight: 500; }
.actions { display: flex; gap: 8px; }
.link { background: none; border: none; color: var(--color-primary); cursor: pointer; font-size: 13px; }
.link.danger { color: var(--color-danger); }
.key { font-family: monospace; font-size: 12px; }
.empty { text-align: center; color: var(--color-text-disabled); padding: 20px; }
.token-box { background: color-mix(in srgb, var(--color-success) 8%, transparent); border: 1px solid color-mix(in srgb, var(--color-success) 30%, transparent); padding: 10px 14px; border-radius: 6px; margin-bottom: 14px; font-size: 13px; }
.drawer-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: var(--color-bg-elevated); border-radius: 10px; padding: 24px; width: 420px; max-width: 90vw; border: 1px solid var(--color-border); }
.modal h2 { font-size: 18px; margin-bottom: 16px; }
.field { display: block; margin-bottom: 14px; font-size: 13px; color: var(--color-text-secondary); }
.field .input { display: block; width: 100%; margin-top: 6px; box-sizing: border-box; }
.modal-actions { display: flex; justify-content: flex-end; gap: 12px; }
</style>