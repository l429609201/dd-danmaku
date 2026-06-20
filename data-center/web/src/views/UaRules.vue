<template>
  <div class="page">
    <h1 class="page-title">UA 限流</h1>
    <div class="toolbar">
      <input v-model="keyword" class="input" placeholder="搜索 ua_key" @keyup.enter="load" />
      <button class="btn btn-primary" @click="load">查询</button>
      <button class="btn" @click="openCreate">新增规则</button>
      <button class="btn" @click="resync">重新下发</button>
    </div>

    <div v-if="msg" class="tip">{{ msg }}</div>

    <div class="panel">
      <table class="data-table">
        <thead><tr>
          <th>ua_key</th><th>UA 匹配</th><th>最大请求</th><th>窗口(ms)</th>
          <th>路径限流</th><th>启用</th><th>操作</th>
        </tr></thead>
        <tbody>
          <tr v-for="r in items" :key="r.id">
            <td class="key">{{ r.ua_key }}</td>
            <td class="msg">{{ r.user_agent || '—' }}</td>
            <td>{{ r.max_requests || '无限制' }}</td>
            <td>{{ r.window_ms }}</td>
            <td>{{ (r.path_limits && r.path_limits.length) || 0 }} 条</td>
            <td>{{ r.enabled ? '是' : '否' }}</td>
            <td class="actions">
              <button class="link" @click="openEdit(r)">编辑</button>
              <button class="link" @click="toggle(r)">{{ r.enabled ? '停用' : '启用' }}</button>
              <button class="link danger" @click="del(r.id)">删除</button>
            </td>
          </tr>
          <tr v-if="!items.length"><td colspan="7" class="empty">暂无规则</td></tr>
        </tbody>
      </table>
      <div class="pager">
        <button class="btn" :disabled="page<=1" @click="prev">上一页</button>
        <span>第 {{ page }} 页 / 共 {{ total }} 条</span>
        <button class="btn" :disabled="page*pageSize>=total" @click="next">下一页</button>
      </div>
    </div>

    <div v-if="showCreate" class="modal-mask" @click.self="showCreate=false">
      <div class="modal">
        <div class="modal-header"><h2>{{ editId ? '编辑' : '新增' }} UA 限流规则</h2><button class="modal-close" @click="showCreate=false">×</button></div>
        <div class="form-item"><label>ua_key（唯一标识，如 dandanplay）</label><input v-model="form.ua_key" class="input full" :disabled="!!editId" /></div>
        <div class="form-item"><label>UA 匹配子串（default 可留空）</label><input v-model="form.user_agent" class="input full" /></div>
        <div class="form-item"><label>最大请求数（0 表示无限制）</label><input v-model.number="form.max_requests" type="number" class="input full" /></div>
        <div class="form-item"><label>时间窗口（毫秒）</label><input v-model.number="form.window_ms" type="number" class="input full" /></div>
        <div class="form-item">
          <label>路径限流（按路径单独限每小时请求数）</label>
          <div v-for="(pl, i) in form.path_limits" :key="i" class="path-row">
            <input v-model="pl.path" class="input" placeholder="路径前缀，如 /api/v2/search" style="flex:1" />
            <input v-model.number="pl.maxRequestsPerHour" type="number" class="input" placeholder="每小时上限" style="width:120px" />
            <button class="link danger" @click="removePathLimit(i)">删除</button>
          </div>
          <button class="btn" style="margin-top:8px" @click="addPathLimit">+ 添加路径限流</button>
        </div>
        <div class="modal-actions">
          <button class="btn" @click="showCreate=false">取消</button>
          <button class="btn btn-primary" :disabled="creating" @click="submit">{{ creating ? '提交中...' : '确认' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { reactive, ref, onMounted } from 'vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'UaRules',
  setup() {
    const items = ref([])
    const total = ref(0)
    const page = ref(1)
    const pageSize = ref(50)
    const keyword = ref('')
    const msg = ref('')
    const showCreate = ref(false)
    const creating = ref(false)
    const editId = ref(null)
    const form = reactive({ ua_key: '', user_agent: '', max_requests: 0, window_ms: 60000, path_limits: [] })

    const load = async () => {
      msg.value = ''
      try {
        const q = new URLSearchParams({ page: page.value, page_size: pageSize.value })
        if (keyword.value) q.set('keyword', keyword.value)
        const res = await apiV2(`/ua-rules?${q.toString()}`)
        items.value = res.items || []
        total.value = res.total || 0
      } catch (e) { msg.value = e.message }
    }

    // 重置表单
    const resetForm = () => {
      form.ua_key = ''; form.user_agent = ''; form.max_requests = 0
      form.window_ms = 60000; form.path_limits = []
    }
    const openCreate = () => { editId.value = null; resetForm(); showCreate.value = true }
    const openEdit = (r) => {
      editId.value = r.id
      form.ua_key = r.ua_key
      form.user_agent = r.user_agent || ''
      form.max_requests = r.max_requests || 0
      form.window_ms = r.window_ms || 60000
      // 深拷贝路径限流，避免直接改到列表数据
      form.path_limits = (r.path_limits || []).map(p => ({
        path: p.path || '', maxRequestsPerHour: p.maxRequestsPerHour || 0,
      }))
      showCreate.value = true
    }
    const addPathLimit = () => { form.path_limits.push({ path: '', maxRequestsPerHour: 0 }) }
    const removePathLimit = (i) => { form.path_limits.splice(i, 1) }

    // 新增或编辑提交（按 editId 区分）
    const submit = async () => {
      if (!form.ua_key) { msg.value = '请填写 ua_key'; return }
      // 过滤空路径行
      const pathLimits = form.path_limits.filter(p => p.path && p.path.trim())
      creating.value = true
      try {
        if (editId.value) {
          const body = {
            user_agent: form.user_agent, max_requests: form.max_requests,
            window_ms: form.window_ms, path_limits: pathLimits,
          }
          const res = await apiV2(`/ua-rules/${editId.value}`, { method: 'PUT', body })
          msg.value = res.message || '更新成功'
        } else {
          const body = { ...form, path_limits: pathLimits }
          const res = await apiV2('/ua-rules', { method: 'POST', body })
          msg.value = res.message || '创建成功'
        }
        showCreate.value = false
        load()
      } catch (e) { msg.value = e.message } finally { creating.value = false }
    }
    const toggle = async (r) => {
      try { await apiV2(`/ua-rules/${r.id}`, { method: 'PUT', body: { enabled: !r.enabled } }); load() }
      catch (e) { msg.value = e.message }
    }
    const del = async (id) => {
      if (!confirm('确认删除该规则？')) return
      try { await apiV2(`/ua-rules/${id}`, { method: 'DELETE' }); load() }
      catch (e) { msg.value = e.message }
    }
    const resync = async () => {
      try { const res = await apiV2('/ua-rules/resync', { method: 'POST' }); msg.value = res.message }
      catch (e) { msg.value = e.message }
    }

    const prev = () => { if (page.value > 1) { page.value--; load() } }
    const next = () => { if (page.value * pageSize.value < total.value) { page.value++; load() } }

    onMounted(load)
    return { items, total, page, pageSize, keyword, msg, showCreate, creating, editId, form,
      load, openCreate, openEdit, addPathLimit, removePathLimit, submit, toggle, del, resync, prev, next }
  }
}
</script>

<style scoped>
.page { padding: 24px; }
.page-title { font-size: 22px; margin-bottom: 20px; color: #333; }
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.input { padding: 8px 12px; border: 1px solid #d9d9d9; border-radius: 6px; }
.btn { padding: 8px 16px; border: 1px solid #d9d9d9; background: #fff; border-radius: 6px; cursor: pointer; }
.btn:disabled { opacity: .6; cursor: not-allowed; }
.btn-primary { background: #1677ff; color: #fff; border-color: #1677ff; }
.tip { background: #e6f4ff; border: 1px solid #91caff; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; color: #0958d9; }
.panel { background: #fff; border-radius: 10px; padding: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
.data-table th { color: #888; font-weight: 500; }
.key { font-family: monospace; font-size: 12px; }
.msg { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.actions { display: flex; gap: 8px; }
.link { background: none; border: none; color: #1677ff; cursor: pointer; font-size: 13px; }
.link.danger { color: #cf1322; }
.empty { text-align: center; color: #999; padding: 20px; }
.pager { display: flex; gap: 12px; align-items: center; margin-top: 14px; justify-content: flex-end; }
.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { width: 440px; background: #fff; border-radius: 12px; padding: 20px; }
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.modal-close { border: none; background: none; font-size: 22px; color: #999; cursor: pointer; }
.form-item { margin-bottom: 14px; }
.form-item label { display: block; margin-bottom: 6px; color: #555; font-size: 13px; }
.input.full { width: 100%; }
.path-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
</style>
