<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { api } from './api.js'
const rows = ref([]), checked = ref([]), results = ref([]), total = ref(0), page = ref(1)
const retention = ref('all'), busy = ref(false), loading = ref(false), error = ref(''), table = ref(null)
let controller
async function load() {
  controller?.abort(); const current = controller = new AbortController()
  loading.value = true; checked.value = []; table.value?.clearSelection(); error.value = ''
  try {
    const data = await api.selectionRecords(page.value, retention.value, current.signal)
    if (!current.signal.aborted) { rows.value = data.items; total.value = data.total }
  } catch (e) { if (!current.signal.aborted) error.value = e.message }
  finally { if (controller === current) loading.value = false }
}
async function retain(keepForever) {
  if (busy.value || !checked.value.length) return
  busy.value = true; error.value = ''
  try {
    // 仅提交当前页所选版本，不将正文的其他用户引用一起改为长期。
    const items = checked.value.map(row => ({ selectionId: row.selectionId, revision: row.revision }))
    await ElMessageBox.confirm(keepForever
      ? '选中用户选择及其正文将长期保留，仍允许播放时刷新。不会修改其他用户选择。'
      : '将从本次操作时重新计算默认保留期限，不改变正文获取时间。', '确认批量保留操作',
    { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消', closeOnClickModal: false })
    results.value = (await api.retainSelections(keepForever, items)).results
    await load()
  } catch (e) { if (e !== 'cancel' && e !== 'close') error.value = e.message || '操作失败' }
  finally { busy.value = false }
}
function filter() { page.value = 1; load() }
function time(value) { return value ? new Date(value).toLocaleString() : '长期保留' }
onMounted(load)
onBeforeUnmount(() => controller?.abort())
</script>
<template>
  <el-card shadow="never">
    <template #header>用户临时选择与长期保留</template>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <p>临时正文与媒体目录共享 XML 分开管理。长期引用保护正文，但不禁止更新。</p>
    <el-select v-model="retention" :disabled="busy || loading" aria-label="保留状态" @change="filter">
      <el-option value="all" label="全部保留状态" /><el-option value="temporary" label="临时有效" />
      <el-option value="forever" label="长期保留" /><el-option value="expired" label="已过期" />
    </el-select>
    <el-button :disabled="busy || loading" @click="load">刷新</el-button>
    <el-button :disabled="busy || loading || !checked.length" @click="retain(true)">批量长期保留</el-button>
    <el-button :disabled="busy || loading || !checked.length" @click="retain(false)">恢复默认保留</el-button>
    <el-table ref="table" :data="rows" row-key="selectionId" v-loading="loading" @selection-change="checked = $event">
      <el-table-column type="selection" :selectable="() => !busy && !loading" width="48" />
      <el-table-column prop="userId" label="用户 ID" min-width="180" />
      <el-table-column prop="itemId" label="媒体 ID" min-width="180" />
      <el-table-column prop="sourceId" label="来源" /><el-table-column prop="sourceEpisodeId" label="来源集 ID" />
      <el-table-column label="保留状态"><template #default="{ row }">{{ row.keepForever ? '长期' : row.expired ? '过期' : '临时' }}</template></el-table-column>
      <el-table-column label="选择到期时间" min-width="180"><template #default="{ row }">{{ time(row.expiresAt) }}</template></el-table-column>
    </el-table>
    <el-pagination v-model:current-page="page" :total="total" :page-size="20" :disabled="busy || loading" layout="prev, pager, next, total" @current-change="load" />
    <el-table v-if="results.length" :data="results">
      <el-table-column prop="selectionId" label="操作目标" /><el-table-column label="结果"><template #default="{ row }">{{ row.success ? '成功' : row.code }}</template></el-table-column>
    </el-table>
  </el-card>
</template>
