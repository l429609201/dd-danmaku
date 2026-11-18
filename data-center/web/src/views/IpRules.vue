<template>
  <div class="app-page">
    <h1 class="app-page__title">IP 黑白名单</h1>
    <p class="app-page__desc">Rust 支持 IP/CIDR 规则 CRUD；类型/关键词筛选、过期时间、创建人及 Worker 下发尚未实现。</p>
    <div class="app-toolbar">
      <el-select v-model="ruleType" placeholder="全部类型" clearable style="width: 130px" @change="reload">
        <el-option label="黑名单" value="black" />
        <el-option label="白名单" value="white" />
      </el-select>
      <el-input v-model="keyword" placeholder="搜索 IP/CIDR" clearable style="width: 200px" @keyup.enter="reload" @clear="reload" />
      <el-button type="primary" :icon="Search" @click="reload">查询</el-button>
      <el-button :icon="Plus" @click="openCreate">新增规则</el-button>
      <el-button :icon="Refresh" @click="resync">重新下发</el-button>
    </div>

    <el-card shadow="never">
      <el-table :data="items" size="small" v-loading="loading" empty-text="暂无规则">
        <el-table-column label="IP/CIDR" min-width="160">
          <template #default="{ row }"><span class="app-mono">{{ row.ip_or_cidr }}</span></template>
        </el-table-column>
        <el-table-column label="类型" width="100">
          <template #default="{ row }">
            <el-tag :type="row.rule_type === 'white' ? 'success' : 'danger'" size="small">
              {{ row.rule_type === 'white' ? '白名单' : '黑名单' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="原因" show-overflow-tooltip>
          <template #default="{ row }">{{ row.reason || '—' }}</template>
        </el-table-column>
        <el-table-column label="启用" width="90">
          <template #default="{ row }">
            <el-switch :model-value="row.enabled" @change="() => toggle(row)" />
          </template>
        </el-table-column>
        <el-table-column prop="created_by" label="创建人" width="120">
          <template #default="{ row }">{{ row.created_by || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button link type="danger" size="small" @click="del(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="app-pager">
        <el-pagination layout="prev, pager, next, jumper, total" :total="total"
                       :page-size="pageSize" :current-page="page" @current-change="onPage" />
      </div>
    </el-card>

    <el-dialog v-model="showCreate" title="新增 IP 规则" width="440px">
      <el-form label-width="110px">
        <el-form-item label="IP / CIDR">
          <el-input v-model="form.ip_or_cidr" placeholder="如 1.2.3.4 或 1.2.3.0/24" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="form.rule_type" style="width: 100%">
            <el-option label="黑名单" value="black" />
            <el-option label="白名单" value="white" />
          </el-select>
        </el-form-item>
        <el-form-item label="原因（可选）">
          <el-input v-model="form.reason" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="create">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import { reactive, ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus, Refresh } from '@element-plus/icons-vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'IpRules',
  setup() {
    const items = ref([])
    const total = ref(0)
    const page = ref(1)
    const pageSize = ref(50)
    const ruleType = ref('')
    const keyword = ref('')
    const loading = ref(false)
    const showCreate = ref(false)
    const creating = ref(false)
    const form = reactive({ ip_or_cidr: '', rule_type: 'black', reason: '' })

    const load = async () => {
      loading.value = true
      try {
        const q = new URLSearchParams({ page: page.value, page_size: pageSize.value })
        // 传入筛选条件（后端支持时生效；前端同时做本地过滤兜底）
        if (ruleType.value) q.set('rule_type', ruleType.value === 'white' ? 'allow' : 'deny')
        if (keyword.value.trim()) q.set('keyword', keyword.value.trim())
        const res = await apiV2(`/rules/ip-rules?${q.toString()}`)
        // 映射语义等价的 IP 黑白名单字段
        let mapped = res.rules.map(r => ({ ...r, ip_or_cidr: r.ip_pattern,
          rule_type: r.rule_type === 'allow' ? 'white' : 'black', reason: r.description, enabled: r.is_active }))
        // 本地过滤兜底（后端不支持参数时仍可按条件筛选）
        if (ruleType.value) mapped = mapped.filter(r => r.rule_type === ruleType.value)
        if (keyword.value.trim()) {
          const kw = keyword.value.trim().toLowerCase()
          mapped = mapped.filter(r => r.ip_or_cidr && r.ip_or_cidr.toLowerCase().includes(kw))
        }
        items.value = mapped
        total.value = res.total || 0
      } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
    }
    const reload = () => { page.value = 1; load() }
    const onPage = (p) => { page.value = p; load() }

    const openCreate = () => { form.ip_or_cidr = ''; form.rule_type = 'black'; form.reason = ''; showCreate.value = true }
    const create = async () => {
      if (!form.ip_or_cidr) { ElMessage.warning('请填写 IP/CIDR'); return }
      creating.value = true
      try {
        const res = await apiV2('/rules/ip-rules', { method: 'POST', body: { ip_pattern: form.ip_or_cidr.trim(), rule_type: form.rule_type === 'white' ? 'allow' : 'deny', description: form.reason || null } })
        ElMessage.success(res.message || '创建成功'); showCreate.value = false; load()
      } catch (e) { ElMessage.error(e.message) } finally { creating.value = false }
    }
    const toggle = async (r) => {
      try { await apiV2(`/rules/ip-rules/${r.id}`, { method: 'PUT', body: { is_active: !r.enabled } }); load() }
      catch (e) { ElMessage.error(e.message) }
    }
    const del = async (id) => {
      try {
        await ElMessageBox.confirm('确认删除该规则？', '提示', { type: 'warning' })
        await apiV2(`/rules/ip-rules/${id}`, { method: 'DELETE' }); ElMessage.success('已删除'); load()
      } catch (e) { if (e !== 'cancel') ElMessage.error(e.message || '操作失败') }
    }
    const resync = () => {
      ElMessage.info('Worker 下发功能暂未实现')
    }
    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')

    onMounted(load)
    return { items, total, page, pageSize, ruleType, keyword, loading, showCreate, creating, form,
      Search, Plus, Refresh, reload, onPage, openCreate, create, toggle, del, resync, fmt }
  }
}
</script>