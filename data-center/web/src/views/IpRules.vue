<template>
  <div class="app-page">
    <h1 class="app-page__title">IP 黑白名单</h1>

    <div class="app-toolbar">
      <el-select v-model="ruleType" placeholder="全部类型" clearable style="width: 130px" @change="reload">
        <el-option label="黑名单" value="black" />
        <el-option label="白名单" value="white" />
      </el-select>
      <el-input v-model="keyword" placeholder="搜索 IP/CIDR" clearable style="width: 200px" @keyup.enter="reload" />
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
        <el-table-column label="过期" width="170">
          <template #default="{ row }">{{ row.expires_at ? fmt(row.expires_at) : '长期' }}</template>
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
        <el-pagination layout="prev, pager, next, total" :total="total"
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
        if (ruleType.value) q.set('rule_type', ruleType.value)
        if (keyword.value) q.set('keyword', keyword.value)
        const res = await apiV2(`/ip-rules?${q.toString()}`)
        items.value = res.items || []
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
        const res = await apiV2('/ip-rules', { method: 'POST', body: { ...form } })
        ElMessage.success(res.message || '创建成功'); showCreate.value = false; load()
      } catch (e) { ElMessage.error(e.message) } finally { creating.value = false }
    }
    const toggle = async (r) => {
      try { await apiV2(`/ip-rules/${r.id}`, { method: 'PUT', body: { enabled: !r.enabled } }); load() }
      catch (e) { ElMessage.error(e.message) }
    }
    const del = async (id) => {
      try {
        await ElMessageBox.confirm('确认删除该规则？', '提示', { type: 'warning' })
        await apiV2(`/ip-rules/${id}`, { method: 'DELETE' }); ElMessage.success('已删除'); load()
      } catch (e) { if (e !== 'cancel') ElMessage.error(e.message || '操作失败') }
    }
    const resync = async () => {
      try { const res = await apiV2('/ip-rules/resync', { method: 'POST' }); ElMessage.success(res.message) }
      catch (e) { ElMessage.error(e.message) }
    }
    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')

    onMounted(load)
    return { items, total, page, pageSize, ruleType, keyword, loading, showCreate, creating, form,
      Search, Plus, Refresh, reload, onPage, openCreate, create, toggle, del, resync, fmt }
  }
}
</script>