<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from './api.js'
const props = defineProps({ record: { type: Object, required: true }, disabled: Boolean })
const emit = defineEmits(['saved'])
const busy = ref(false)
let disposed = false
// 卸载后不再提交确认中的文件；已发出的写入仍由后端版本校验保护。
onBeforeUnmount(() => { disposed = true })
async function upload(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || busy.value || props.disabled) return
  if (!file.size || file.size > 32 * 1024 * 1024) { ElMessage.error('XML 必须非空且不超过32 MiB'); return }
  const record = props.record
  const itemId = record.itemId, source = record.source || ''
  const current = () => !disposed && props.record === record && !props.disabled
  busy.value = true
  try {
    const version = await api.sharedVersion(itemId, source)
    if (!current()) return
    const exists = version.exists ?? version.Exists
    const hash = version.expectedHash ?? version.ExpectedHash
    if (typeof exists !== 'boolean' || (exists && !/^[a-f0-9]{64}$/i.test(hash || '')))
      throw new Error('共享版本响应无效，请刷新后重试')
    await ElMessageBox.confirm(exists
      ? '将覆盖该媒体和来源的共享 XML，影响所有使用它的用户。是否继续？'
      : '将为该媒体和来源创建共享 XML。是否继续？', '上传共享 XML', { type: 'warning' })
    if (!current()) return
    await api.uploadShared(itemId, source, file, exists, hash)
    if (!current()) return
    ElMessage.success('共享 XML 已保存')
    emit('saved')
  } catch (error) {
    // 版本冲突必须重新读取并由用户再次确认，不自动重试覆盖。
    if (current() && error !== 'cancel' && error !== 'close') ElMessage.error(error.status === 409
      ? '共享文件状态已变化，请重新选择文件并确认；本次未自动重试。'
      : error.message || '上传失败')
  } finally { busy.value = false }
}
</script>
<template>
  <div class="toolbar">
    <label>上传共享 XML：<input type="file" accept=".xml,application/xml,text/xml"
      :disabled="disabled || busy || !record.available" @change="upload" /></label>
    <span v-if="busy" role="status">正在处理，请勿重复提交…</span>
  </div>
</template>
