<script setup>
import { ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { api } from './api.js'
const props = defineProps({ rows: { type: Array, default: () => [] }, disabled: Boolean })
const emit = defineEmits(['busy', 'done', 'clear'])
const busy = ref(false), report = ref(null), error = ref('')
const labels = { verify: '批量校验', normalize: '批量规范化', remove: '仅移除记录', delete: '删除 XML 与记录' }
const notices = { verify: '读取文件并更新最近校验状态；校验成功不代表 XML 有效。', normalize: '将重写所选 XML 为标准格式，原文件被替换。', remove: '仅移除索引，保留 XML；扫描后可能重新收录。', delete: '永久删除所选来源 XML 并移除索引，不删除视频；无法通过此页面恢复。' }
async function run(action) {
  if (busy.value || props.disabled || !props.rows.length) return
  // 确认前固定本次选择，不因列表或复选框变化扩大操作范围。
  const rows = [...props.rows], ids = rows.map(row => row.recordId)
  busy.value = true; emit('busy', true); error.value = ''; report.value = null
  try {
    await ElMessageBox.confirm(`已选择 ${ids.length} 条记录。${notices[action]}\n媒体失联项仅支持移除索引，其他操作将逐项返回失败。`, labels[action], {
      type: 'warning', confirmButtonText: `确认${labels[action]}`, cancelButtonText: '取消', closeOnClickModal: false,
    })
    const data = await api.batchRecords(action, ids)
    const names = new Map(rows.map(row => [row.recordId, `${row.title} ${row.episode || ''} · ${row.source || '未标注来源'}`]))
    report.value = { ...data, results: data.results.map(item => ({ ...item, name: names.get(item.recordId) || item.recordId })) }
    emit('done')
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') {
      error.value = `${e.message || '批量请求失败'}；请求中断时可能已有部分操作完成，请刷新核对后再重试。`
      emit('done')
    }
  } finally { busy.value = false; emit('busy', false) }
}
</script>
<template>
  <div class="batch-tools">
    <span>当前页已选 {{ rows.length }} 条</span>
    <el-button :disabled="disabled || busy || !rows.length" @click="emit('clear')">取消选择</el-button>
    <el-button v-for="(label, action) in labels" :key="action" :type="action === 'delete' ? 'danger' : action === 'normalize' ? 'warning' : 'default'" plain :disabled="disabled || busy || !rows.length" @click="run(action)">{{ label }}</el-button>
  </div>
  <el-alert v-if="error" :title="error" type="error" :closable="false" />
  <el-alert v-if="report" :type="report.failed || report.skipped ? 'warning' : 'success'" :title="`处理完成：成功 ${report.succeeded}，失败 ${report.failed}，跳过 ${report.skipped}（校验成功仅表示完成检查）`" :closable="false" />
  <el-collapse v-if="report"><el-collapse-item title="查看本批次逐项结果" name="results">
    <div v-for="(item, index) in report.results" :key="index" class="result">{{ item.name }}：{{ item.status === 'succeeded' ? '成功' : item.status === 'failed' ? '失败' : '跳过' }} · {{ item.message }}<span v-if="item.detail?.state"> · 校验状态：{{ { valid: '有效', empty: '空弹幕', invalid: '异常', missing: 'XML 缺失', noncanonical: '需规范化' }[item.detail.state] || item.detail.state }}</span></div>
  </el-collapse-item></el-collapse>
</template>
<style scoped>
.batch-tools{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:12px 0}.batch-tools .el-button{margin-left:0}.result{padding:5px 0;overflow-wrap:anywhere}
</style>
