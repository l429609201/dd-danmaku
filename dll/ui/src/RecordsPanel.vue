<script setup>
import { onMounted, onBeforeUnmount, reactive, ref } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { api } from './api.js'
import RecordBatchToolbar from './RecordBatchToolbar.vue'
import SelectionRecordsPanel from './SelectionRecordsPanel.vue'
import SharedUploadControl from './SharedUploadControl.vue'
const rows = ref([]), loading = ref(false), error = ref(''), page = ref(1), total = ref(0)
const drawer = ref(false), selected = ref(null), detail = ref(null), detailLoading = ref(false), busy = ref(false)
const table = ref(null), checked = ref([])
const filters = reactive({ keyword: '', source: '', state: '', mediaType: '' })
const mediaTypes = { movie: '电影', episode: '剧集', other: '其他视频', unlinked: '未关联' }
const states = { unverified: '未校验', noncanonical: '需规范化', valid: '有效', empty: '空弹幕', invalid: '异常 / 不可读', missing: 'XML 缺失', unlinked: '媒体失联 / 不可访问' }
let listRequest, detailRequest
// 翻页、刷新、筛选时清空选择，禁止隐式跨页操作；旧请求不能覆盖新列表。
async function load() {
  checked.value = []; table.value?.clearSelection()
  listRequest?.abort(); const controller = listRequest = new AbortController()
  loading.value = true; error.value = ''
  try {
    const data = await api.records(page.value, 20, controller.signal, filters)
    if (controller.signal.aborted) return
    total.value = data.total; rows.value = data.items
    if (page.value > 1 && !rows.value.length) { page.value = Math.max(1, Math.ceil(total.value / 20)); await load() }
  } catch (e) { if (!controller.signal.aborted) error.value = e.message }
  finally { if (listRequest === controller) loading.value = false }
}
function search() { if (busy.value) return; page.value = 1; load() }
// 重置同时移除可选季号，避免界面清空后请求仍携带旧筛选。
function reset() { delete filters.seasonNumber; Object.assign(filters, { keyword: '', source: '', state: '', mediaType: '' }); search() }
function batchDone() { closeDetail(); drawer.value = false; load() }
function closeDetail() {
  // 关闭或切换详情时卸载上传控件，撤销尚未确认的提交。
  detailRequest?.abort(); detailLoading.value = false; selected.value = null
}
async function show(row) {
  closeDetail(); selected.value = row; detail.value = null; drawer.value = true
  if (!row.available) return
  const controller = detailRequest = new AbortController(); detailLoading.value = true
  try {
    const data = await api.recordDetail(row.recordId, controller.signal)
    if (!controller.signal.aborted) detail.value = data
  } catch (e) { if (!controller.signal.aborted) error.value = e.message }
  finally { if (detailRequest === controller) detailLoading.value = false }
}
function openMedia(row) {
  try { window.open(api.mediaLink(row.mediaId), '_blank', 'noopener,noreferrer') }
  catch (e) { error.value = e.message }
}
async function act(row, action) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    if (action === 'remove' || action === 'delete') {
      const file = action === 'delete'
      await ElMessageBox.confirm(`${row.title} · ${row.episode || ''} · 来源：${row.source || '未标注来源'}\n${file ? '将删除该来源 XML 并移除记录，不删除视频。文件无法通过此页面恢复。' : '仅移除索引，不删除 XML。下次扫描可能重新收录。'}`, file ? '确认删除 XML 文件' : '确认仅移除记录', {
        type: 'warning', confirmButtonText: file ? '删除 XML 与记录' : '仅移除记录', cancelButtonText: '取消', closeOnClickModal: false,
      })
      await api.removeRecord(row.recordId, file)
      if (selected.value?.recordId === row.recordId) { closeDetail(); drawer.value = false }
      ElMessage.success(file ? 'XML 与记录已删除' : '记录已移除，XML 保留')
    } else if (action === 'verify') {
      const data = await api.verifyRecord(row.recordId)
      ElMessage.success(`校验完成：${states[data.state] || data.state}`)
      if (drawer.value && selected.value?.recordId === row.recordId) await show(row)
    } else if (action === 'normalize') {
      await ElMessageBox.confirm(`${row.title} · ${row.episode || ''} · 来源：${row.source || '未标注来源'}\n将把兼容 XML 解析后重新写成标准 i/d/p 格式，原文件会被原子替换。`, '确认规范化 XML', {
        type: 'warning', confirmButtonText: '规范化并替换', cancelButtonText: '取消', closeOnClickModal: false,
      })
      const data = await api.normalizeRecord(row.recordId)
      ElMessage.success(`规范化完成：${data.commentCount ?? 0} 条弹幕`)
      if (drawer.value && selected.value?.recordId === row.recordId) await show(row)
    } else { await api.downloadRecord(row.recordId); return }
    await load()
  } catch (e) { if (e !== 'cancel' && e !== 'close') error.value = e.message || '操作失败' }
  finally { busy.value = false }
}
function time(value) { return value ? new Date(value).toLocaleString() : '未知' }
onMounted(load)
onBeforeUnmount(() => { listRequest?.abort(); closeDetail() })
</script>
<template>
  <SelectionRecordsPanel />
  <section class="panel"><el-card shadow="never">
    <template #header><div class="panel-head"><strong>弹幕记录管理</strong><el-button :disabled="busy" :loading="loading" @click="load">刷新</el-button></div></template>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-form class="filters" label-position="top" :disabled="busy" @submit.prevent="search">
      <el-form-item label="媒体名称 / 季集 / 媒体库 / ID"><el-input v-model="filters.keyword" clearable placeholder="搜索对应电影或剧集" maxlength="200" /></el-form-item>
      <el-form-item label="来源"><el-input v-model="filters.source" clearable placeholder="按来源搜索" maxlength="64" /></el-form-item>
      <el-form-item label="媒体类型"><el-select v-model="filters.mediaType" clearable placeholder="全部"><el-option v-for="(label, key) in mediaTypes" :key="key" :value="key" :label="label" /></el-select></el-form-item>
      <el-form-item label="最近校验状态"><el-select v-model="filters.state" clearable placeholder="全部"><el-option value="abnormal" label="异常汇总（不可读 / 缺失 / 失联）" /><el-option v-for="(label, key) in states" :key="key" :value="key" :label="label" /></el-select></el-form-item>
      <!-- 季编号由后端按 Emby 元数据过滤；清空时不限制季，0 表示特别篇。 -->
      <el-form-item label="季编号（0 为特别篇）"><el-input-number :model-value="filters.seasonNumber" :min="0" :precision="0" placeholder="全部季" @update:model-value="value => { if (value == null) delete filters.seasonNumber; else filters.seasonNumber = value }" /></el-form-item>
      <el-button type="primary" native-type="submit">查询</el-button><el-button @click="reset">重置</el-button>
    </el-form>
    <p class="muted">按媒体与来源管理；状态是最近一次扫描 / 校验结果。表头可全选当前页，翻页或刷新会清空选择，不跨页批量。</p>
    <RecordBatchToolbar :rows="checked" :disabled="busy || loading" @busy="busy = $event" @done="batchDone" @clear="table?.clearSelection()" />
    <el-table ref="table" :data="rows" row-key="recordId" v-loading="loading" stripe @selection-change="checked = $event">
      <el-table-column type="selection" width="48" :selectable="() => !busy && !loading" />
      <el-table-column label="对应媒体" min-width="260"><template #default="{ row }"><strong>{{ row.title }}</strong><div>{{ row.episode }}</div><small class="muted">{{ mediaTypes[row.mediaType] || '其他' }} · {{ row.library || '未关联媒体库' }}</small></template></el-table-column>
      <el-table-column label="来源" min-width="130"><template #default="{ row }">{{ row.source || '未标注来源' }}</template></el-table-column>
      <el-table-column label="状态 / 条数" min-width="160"><template #default="{ row }"><el-tag :type="row.state === 'valid' ? 'success' : 'warning'">{{ states[row.state] || row.state }}</el-tag><div>{{ row.commentCount == null ? '条数未知' : `${row.commentCount} 条` }}</div></template></el-table-column>
      <el-table-column label="更新时间" min-width="175"><template #default="{ row }">{{ time(row.updatedAt) }}</template></el-table-column>
      <el-table-column label="操作" min-width="210"><template #default="{ row }"><div class="actions"><el-button :disabled="busy" @click="show(row)">管理详情</el-button><el-button :disabled="!row.available" @click="openMedia(row)">打开媒体</el-button></div></template></el-table-column>
    </el-table>
    <el-pagination v-model:current-page="page" :disabled="busy || loading" :page-size="20" :total="total" layout="total, prev, pager, next" @current-change="load" />
  </el-card>
  <el-drawer v-model="drawer" title="弹幕管理详情" size="680px" @close="closeDetail">
    <template v-if="selected">
      <h3>{{ selected.title }}</h3><p>{{ selected.episode }}</p>
      <el-alert v-if="!selected.available" title="媒体不存在或不可访问；仅允许移除索引，不能操作文件。" type="warning" :closable="false" />
      <el-descriptions :column="1" border>
        <el-descriptions-item label="媒体库">{{ selected.library || '未关联' }}</el-descriptions-item>
        <el-descriptions-item label="媒体 ID">{{ selected.itemId }}</el-descriptions-item>
        <el-descriptions-item label="来源">{{ selected.source || '未标注来源（同名 XML）' }}</el-descriptions-item>
        <!-- 旧文件没有归属与时间信息时明确显示未知，不推断保存者。 -->
        <el-descriptions-item label="文件所有者">{{ selected.ownerUserName || selected.ownerUserId || '未记录个人归属' }}</el-descriptions-item>
        <el-descriptions-item label="最近更新者">{{ selected.updatedByUserId || '未知' }}</el-descriptions-item>
        <el-descriptions-item label="写入方式">{{ ({ upload: '上传', normalize: '格式规范化', auto: '自动保存', merge: '合并' })[selected.writeMethod] || selected.writeMethod || '未知' }}</el-descriptions-item>
        <el-descriptions-item label="来源作品 / 集 ID">{{ selected.sourceAnimeId || '未知' }} / {{ selected.sourceEpisodeId || '未知' }}</el-descriptions-item>
        <el-descriptions-item label="内容获取时间">{{ time(selected.fetchedAt) }}</el-descriptions-item>
        <el-descriptions-item label="媒体位置"><span class="path">{{ detail?.mediaPath || '暂不可用' }}</span></el-descriptions-item>
        <el-descriptions-item label="XML 位置"><span class="path">{{ detail?.detail?.xmlPath || '暂不可用' }}</span></el-descriptions-item>
        <el-descriptions-item label="当前读取状态">{{ detail ? states[detail.detail.state] : '尚未读取' }}</el-descriptions-item>
        <el-descriptions-item label="当前弹幕条数">{{ detail?.detail?.commentCount ?? '未知' }}</el-descriptions-item>
        <el-descriptions-item label="索引创建时间">{{ time(selected.storedAt) }}</el-descriptions-item>
      </el-descriptions>
      <div class="actions toolbar"><el-button :disabled="!selected.available" @click="openMedia(selected)">打开 Emby 媒体详情</el-button><el-button :disabled="!selected.available || busy" @click="act(selected, 'download')">下载 XML</el-button><el-button :disabled="!selected.available || busy" @click="act(selected, 'verify')">重新校验</el-button><el-button type="warning" plain :disabled="!selected.available || busy" @click="act(selected, 'normalize')">规范化 XML</el-button></div>
      <!-- 上传组件随目标重建，版本确认与普通记录操作保持独立。 -->
      <SharedUploadControl :key="selected.recordId || selected.itemId" :record="selected" :disabled="busy" @saved="load(); closeDetail()" />
      <el-divider>弹幕预览（最多 30 条）</el-divider>
      <el-skeleton v-if="detailLoading" :rows="4" animated /><el-empty v-else-if="!detail?.detail?.comments?.length" description="没有可预览的弹幕" />
      <div v-for="(item, index) in detail?.detail?.comments || []" :key="index" class="comment"><b>{{ item.time }}s</b> {{ item.text }}</div>
      <el-divider>删除操作</el-divider><p class="muted">删除文件不可恢复；仅移除记录会保留 XML，重新扫描可再次收录。</p>
      <div class="actions"><el-button :disabled="busy" @click="act(selected, 'remove')">仅移除记录</el-button><el-button type="danger" plain :disabled="!selected.available || busy" @click="act(selected, 'delete')">删除 XML 与记录</el-button></div>
    </template>
  </el-drawer></section>
</template>
<style scoped>
.panel-head,.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.panel-head{justify-content:space-between}
.filters{display:flex;align-items:flex-end;flex-wrap:wrap;gap:12px;margin-top:16px}.filters .el-form-item{flex:1 1 180px;margin-bottom:0}.filters .el-select{width:100%}
.muted{color:var(--el-text-color-secondary);font-size:13px}.toolbar{margin-top:16px}.path{word-break:break-all}
.actions .el-button{margin-left:0}.el-pagination{margin-top:16px;justify-content:flex-end;flex-wrap:wrap}.comment{padding:7px 0;border-bottom:1px solid var(--el-border-color);overflow-wrap:anywhere}.comment b{display:inline-block;min-width:70px}
@media(max-width:600px){.filters{display:block}.filters .el-form-item{margin-bottom:12px}.el-button{min-height:44px}.actions{align-items:stretch}}
</style>
