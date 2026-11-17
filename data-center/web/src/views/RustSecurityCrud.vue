<template>
  <section class="rust-security">
    <h2>{{ title }}（Rust 原生契约）</h2>
    <p>此面板管理 Rust 独立数据模型，不代表下方旧 Worker 功能已经实现；密钥仅返回脱敏值，编辑留空表示保留。</p>
    <p role="status">{{ message }}</p>
    <button @click="load">刷新</button> <button @click="create">新增</button>
    <table><thead><tr><th>ID</th><th v-for="f in fields" :key="f.key">{{ f.label }}</th><th>启用</th><th>操作</th></tr></thead>
      <tbody><tr v-for="row in rows" :key="row.id"><td>{{ row.id }}</td><td v-for="f in fields" :key="f.key">{{ row[f.key] ?? '—' }}</td><td>{{ row.is_active ? '是' : '否' }}</td><td><button @click="edit(row)">编辑</button><button @click="toggle(row)">{{ row.is_active ? '停用' : '启用' }}</button><button @click="remove(row)">删除</button></td></tr></tbody>
    </table>
    <div v-if="total > pageSize"><button :disabled="page <= 1" @click="changePage(-1)">上一页</button>{{ page }} / {{ Math.ceil(total / pageSize) }}<button :disabled="page * pageSize >= total" @click="changePage(1)">下一页</button></div>
    <form v-if="editing" @submit.prevent="save">
      <h3>{{ editId == null ? '新增' : '编辑' }}</h3>
      <label v-for="f in fields" :key="f.key">{{ f.label }}<input v-model="form[f.key]" :type="f.secret ? 'password' : f.number ? 'number' : 'text'" :disabled="editId != null && f.immutable" :required="!f.optional && !(editId != null && f.secret)" :placeholder="f.secret && editId != null ? '留空保留原值' : ''" /></label>
      <button :disabled="saving" type="submit">保存</button><button type="button" @click="editing = false">取消</button>
    </form>
  </section>
</template>

<script>
import { ref, reactive, onMounted } from 'vue'
import { apiV2 } from '../utils/api.js'

// 显式声明四种 Rust 模型，禁止把旧 App/OAuth/用户组语义冒充为同义字段。
const schemas = {
  ua: { title: 'UA 匹配规则（不是限流规则）', path: '/rules/ua-rules', list: 'rules', fields: [
    { key: 'ua_pattern', label: 'UA 匹配' }, { key: 'rule_type', label: '类型（allow/deny）' },
    { key: 'description', label: '说明', optional: true }, { key: 'priority', label: '优先级', number: true, optional: true },
  ] },
  api: { title: 'API 密钥', path: '/keys/api-keys', list: 'keys', fields: [
    { key: 'name', label: '名称' }, { key: 'api_key', label: 'API 密钥', secret: true },
    { key: 'source', label: '来源' }, { key: 'priority', label: '优先级', number: true, optional: true },
  ] },
  sign: { title: '签名密钥', path: '/keys/sign-keys', list: 'keys', fields: [
    { key: 'name', label: '名称' }, { key: 'sign_key', label: '签名密钥', secret: true }, { key: 'purpose', label: '用途' },
  ] },
  user: { title: '单用户白名单', path: '/keys/user-allows', list: 'users', fields: [
    { key: 'user_identifier', label: '用户标识', immutable: true }, { key: 'user_type', label: '用户类型' }, { key: 'description', label: '说明', optional: true },
  ] },
  oauth: { title: 'OAuth 单 Provider 客户端', path: '/keys/oauth-configs', list: 'configs', fields: [
    { key: 'provider', label: 'Provider', immutable: true }, { key: 'client_id', label: 'Client ID' },
    { key: 'client_secret', label: 'Client Secret', secret: true }, { key: 'redirect_uri', label: '回调 URI' }, { key: 'scope', label: 'Scope', optional: true },
  ] },
}
export default {
  name: 'RustSecurityCrud',
  props: { kind: { type: String, required: true } },
  setup(props) {
    const schema = schemas[props.kind]
    const rows = ref([]), total = ref(0), page = ref(1), pageSize = 50
    const message = ref(''), editing = ref(false), editId = ref(null), saving = ref(false)
    const form = reactive({})
    const load = async () => {
      try {
        const query = props.kind === 'oauth' ? '' : `?page=${page.value}&page_size=${pageSize}`
        const data = await apiV2(schema.path + query)
        if (!Array.isArray(data?.[schema.list])) throw new Error('Rust 列表响应不符合契约')
        rows.value = data[schema.list]; total.value = data.total ?? rows.value.length
      } catch (e) { message.value = e.message }
    }
    const create = () => {
      editId.value = null
      for (const f of schema.fields) form[f.key] = f.number ? 100 : ''
      editing.value = true
    }
    const edit = (row) => {
      editId.value = row.id
      // 不把脱敏占位写回数据库；保留密钥必须省略该字段。
      for (const f of schema.fields) form[f.key] = f.secret ? '' : row[f.key] ?? ''
      editing.value = true
    }
    const save = async () => {
      const body = {}
      for (const f of schema.fields) {
        if (editId.value != null && (f.immutable || (f.secret && !form[f.key]))) continue
        const value = form[f.key]
        if (!f.optional && !String(value ?? '').trim()) { message.value = `请填写${f.label}`; return }
        if (f.number) {
          if (value === '') continue
          if (!Number.isInteger(Number(value)) || Number(value) < -2147483648 || Number(value) > 2147483647) { message.value = '优先级必须为 32 位整数'; return }
          body[f.key] = Number(value)
        } else body[f.key] = value || null
      }
      saving.value = true
      try {
        await apiV2(schema.path + (editId.value != null ? `/${editId.value}` : ''), { method: editId.value != null ? 'PUT' : 'POST', body })
        editing.value = false; message.value = '已保存 Rust 配置（不代表已下发 Worker）'; await load()
      } catch (e) { message.value = e.message } finally { saving.value = false }
    }
    const toggle = async (row) => {
      try { await apiV2(`${schema.path}/${row.id}`, { method: 'PUT', body: { is_active: !row.is_active } }); await load() }
      catch (e) { message.value = e.message }
    }
    const remove = async (row) => {
      if (!confirm(`确认删除 Rust ${schema.title} #${row.id}？`)) return
      try { await apiV2(`${schema.path}/${row.id}`, { method: 'DELETE' }); message.value = '已删除'; await load() }
      catch (e) { message.value = e.message }
    }
    const changePage = (delta) => { page.value += delta; load() }
    onMounted(load)
    return { ...schema, rows, total, page, pageSize, message, editing, editId, form, saving, load, create, edit, save, toggle, remove, changePage }
  },
}
</script>

<style scoped>
.rust-security { padding: 20px; margin-bottom: 20px; border: 1px solid #91caff; background: #fff; }
table { width: 100%; border-collapse: collapse; } th, td { padding: 8px; text-align: left; border-bottom: 1px solid #eee; overflow-wrap: anywhere; }
label { display: block; margin: 10px 0; } input { margin-left: 12px; padding: 6px; } button { margin: 4px; padding: 6px 10px; }
</style>
