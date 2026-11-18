<template>
  <section class="rust-security">
    <h2>{{ title }}（Rust 原生契约）</h2>
    <p class="rust-security__desc">此面板管理 Rust 独立数据模型，不代表下方旧 Worker 功能已经实现；密钥仅返回脱敏值，编辑留空表示保留。</p>
    <div class="rust-security__toolbar">
      <el-button :icon="Refresh" @click="load">刷新</el-button>
      <el-button type="primary" :icon="Plus" @click="create">新增</el-button>
    </div>
    <el-table :data="rows" v-loading="loading" stripe style="width: 100%">
      <el-table-column prop="id" label="ID" width="60" />
      <el-table-column v-for="f in fields" :key="f.key" :prop="f.key" :label="f.label" show-overflow-tooltip>
        <template #default="{ row }">{{ row[f.key] ?? '—' }}</template>
      </el-table-column>
      <el-table-column label="启用" width="90">
        <template #default="{ row }">
          <el-switch :model-value="row.is_active" @change="() => toggle(row)" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="edit(row)">编辑</el-button>
          <el-button size="small" type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-if="total > pageSize"
      :current-page="page"
      :page-size="pageSize"
      :total="total"
      layout="prev, pager, next"
      @current-change="(p) => { page.value = p; load() }"
      style="margin-top: 16px; justify-content: center;"
    />
    <!-- 新增/编辑弹窗 -->
    <el-dialog v-model="editing" :title="editId == null ? '新增' : '编辑'" width="500px">
      <el-form label-width="120px">
        <el-form-item v-for="f in fields" :key="f.key" :label="f.label">
          <el-input
            v-model="form[f.key]"
            :type="f.secret ? 'password' : 'text'"
            :show-password="f.secret"
            :disabled="editId != null && f.immutable"
            :placeholder="f.secret && editId != null ? '留空保留原值' : ''"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editing = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Plus } from '@element-plus/icons-vue'
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
    const loading = ref(false), editing = ref(false), editId = ref(null), saving = ref(false)
    const form = reactive({})
    const load = async () => {
      loading.value = true
      try {
        const query = props.kind === 'oauth' ? '' : `?page=${page.value}&page_size=${pageSize}`
        const data = await apiV2(schema.path + query)
        if (!Array.isArray(data?.[schema.list])) throw new Error('Rust 列表响应不符合契约')
        rows.value = data[schema.list]; total.value = data.total ?? rows.value.length
      } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
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
        if (!f.optional && !String(value ?? '').trim()) { ElMessage.warning(`请填写${f.label}`); return }
        if (f.number) {
          if (value === '') continue
          if (!Number.isInteger(Number(value)) || Number(value) < -2147483648 || Number(value) > 2147483647) { ElMessage.warning('优先级必须为 32 位整数'); return }
          body[f.key] = Number(value)
        } else body[f.key] = value || null
      }
      saving.value = true
      try {
        await apiV2(schema.path + (editId.value != null ? `/${editId.value}` : ''), { method: editId.value != null ? 'PUT' : 'POST', body })
        editing.value = false; ElMessage.success('已保存 Rust 配置（不代表已下发 Worker）'); await load()
      } catch (e) { ElMessage.error(e.message) } finally { saving.value = false }
    }
    const toggle = async (row) => {
      try { await apiV2(`${schema.path}/${row.id}`, { method: 'PUT', body: { is_active: !row.is_active } }); await load() }
      catch (e) { ElMessage.error(e.message) }
    }
    const remove = async (row) => {
      try { await ElMessageBox.confirm(`确认删除 Rust ${schema.title} #${row.id}？`, '删除确认', { type: 'warning' }) }
      catch { return }
      try { await apiV2(`${schema.path}/${row.id}`, { method: 'DELETE' }); ElMessage.success('已删除'); await load() }
      catch (e) { ElMessage.error(e.message) }
    }
    onMounted(load)
    return { ...schema, rows, total, page, pageSize, loading, editing, editId, form, saving, load, create, edit, save, toggle, remove, Refresh, Plus }
  },
}
</script>

<style scoped>
.rust-security { padding: 20px; margin-bottom: 20px; border: 1px solid var(--el-border-color); background: var(--el-bg-color, var(--el-fill-color-blank)); border-radius: 10px; }
.rust-security h2 { font-size: 18px; margin-bottom: 8px; }
.rust-security__desc { color: #909399; font-size: 13px; margin-bottom: 16px; line-height: 1.6; }
.rust-security__toolbar { margin-bottom: 16px; display: flex; gap: 8px; }
</style>
