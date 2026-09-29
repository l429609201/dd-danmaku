<script setup>
import { computed, onMounted, ref } from 'vue'
import { api } from './api.js'
// 已保存敏感值独立显示，不将回显内容当成新的替换输入。
import PlayerParameterEditor from './PlayerParameterEditor.vue'
import { parameterFields, parseParameter, serializeParameter } from './parameterFields.js'
import ParameterMigrationSwitch from './ParameterMigrationSwitch.vue'
import { useParameterAutosave } from './useParameterAutosave.js'
import './playerSettings.css'

const files = ref([]), users = ref([]), selected = ref(''), namespace = ref('dd-danmaku')
const rows = ref([]), values = ref({}), enabled = ref({}), clear = ref({}), busy = ref(false), error = ref(''), message = ref('')
const target = ref(''), copyDialog = ref(false), search = ref('')
const namespaces = computed(() => [...new Set(['dd-danmaku', ...rows.value.map(r => r.namespace)])])
const unknown = computed(() => rows.value.filter(r => r.namespace === namespace.value && !parameterFields.some(f => f.id === r.key)))
// 保存任务捕获用户及命名空间，不因后续切换而写到其他用户。
const autosave = useParameterAutosave(async ({ userId, space, entry: draft, clearing }) => {
  // 校验也进入队列，错误草稿可被同字段的新值替换，重试不会丢失。
  const field = parameterFields.find(f => f.id === draft.key)
  const entry = { ...draft, value: clearing ? '' : serializeParameter(field, draft.value) }
  await api.saveParameterFile(userId, { namespace: space, parameters: [entry], clearSecrets: clearing ? [entry.key] : [] })
  if (selected.value === userId && namespace.value === space) {
    const row = rows.value.find(r => r.namespace === space && r.key === entry.key)
    if (row) row.value = entry.value
    else rows.value.push({ ...entry, namespace: space })
  }
})
const { saving, error: saveError, message: saveMessage } = autosave
async function refresh() { files.value = await api.parameterFiles(); users.value = await api.users() }
function fill() {
  values.value = {}; enabled.value = {}; clear.value = {}
  for (const field of parameterFields) {
    const row = rows.value.find(r => r.namespace === namespace.value && r.key === field.id)
    enabled.value[field.id] = true
    values.value[field.id] = field.sensitive ? '' : row ? parseParameter(field, row.value)
      : field.type === 'json' ? JSON.stringify(field.value, null, 2) : field.value
  }
}
async function load() {
  if (!selected.value) return
  busy.value = true; error.value = ''; message.value = ''
  try { rows.value = await api.parameterFile(selected.value); fill() }
  catch (e) { rows.value = []; error.value = e.message }
  finally { busy.value = false }
}
function commit(id, value, clearing = false) {
  const field = parameterFields.find(f => f.id === id)
  if (!field || !selected.value || busy.value || error.value) return
  values.value[id] = value
  // 留空不清除敏感值；清除必须来自独立确认操作。
  if (field.sensitive && !value && !clearing) return
  const entry = { key: id, value, type: field.type, description: field.label }
  autosave.submit(`${selected.value}:${namespace.value}:${id}`, { userId: selected.value, space: namespace.value, entry, clearing })
}
async function remove() {
  if (!window.confirm('确认清空此用户整份主动参数？不影响账号和用户专属默认。播放器本地缓存可能再次同步上传。')) return
  busy.value = true; error.value = ''
  try { await api.deleteParameterFile(selected.value); rows.value = []; fill(); await refresh(); message.value = '已清空，保留空文件阻止旧参数回退' }
  catch (e) { error.value = e.message } finally { busy.value = false }
}
async function copy() {
  if (!target.value || target.value === selected.value) return
  const overwrite = window.confirm('将整份覆盖目标用户主动参数；不复制令牌、密钥、个人 Bangumi 配置或可能含凭据的地址。确认继续？')
  if (!overwrite) return
  busy.value = true; error.value = ''
  try { const result = await api.copyParameterFile(selected.value, { targetUserId: target.value, overwrite }); await refresh(); copyDialog.value = false; message.value = `已复制 ${result.copied} 项，跳过 ${result.skipped} 项` }
  catch (e) { error.value = e.message } finally { busy.value = false }
}
onMounted(async () => { busy.value = true; try { await refresh() } catch (e) { error.value = e.message } finally { busy.value = false } })
</script>
<template>
  <section v-loading="busy" class="file-manager ede-surface">
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-alert v-if="message" :title="message" type="success" :closable="false" />
    <el-card shadow="never"><template #header>用户参数文件管理</template>
      <el-alert title="仅保存实际修改项，未编辑的参数保持原值。敏感值默认遮罩，留空保留，清除需确认。" type="info" :closable="false" />
      <el-table :data="files" stripe><el-table-column prop="name" label="用户" /><el-table-column prop="fileName" label="文件" min-width="250" /><el-table-column label="来源"><template #default="{ row }">{{ row.legacy ? '旧格式（保存后迁移）' : 'Data' }}</template></el-table-column><el-table-column prop="size" label="字节" width="100" /><el-table-column label="操作" width="90"><template #default="{ row }"><el-button link :disabled="busy || saving || !!saveError" @click="selected = row.userId; load()">管理</el-button></template></el-table-column></el-table>
      <div class="toolbar"><el-select v-model="selected" filterable placeholder="选择用户（可创建新文件）" :disabled="busy || saving || !!saveError" @change="load"><el-option v-for="u in users" :key="u.id" :label="u.name" :value="u.id" /></el-select><el-button :disabled="!selected || busy || saving || !!saveError" @click="target = ''; copyDialog = true">复制到用户</el-button><el-button type="danger" plain :disabled="!selected || busy || saving || !!saveError" @click="remove">删除整份参数</el-button></div>
    </el-card>
    <ParameterMigrationSwitch v-if="selected" :key="selected" :user-id="selected" :files="files" :disabled="busy || saving || !!saveError" @converted="refresh().catch(e => { error = '转换成功，但列表刷新失败：' + e.message })" />
    <el-card v-if="selected" shadow="never"><template #header>完整播放器参数</template>
      <div class="toolbar"><el-select v-model="namespace" filterable allow-create default-first-option :disabled="busy || saving || !!saveError" @change="fill"><el-option v-for="n in namespaces" :key="n" :label="n" :value="n" /></el-select><el-input v-model="search" placeholder="搜索参数名或键" clearable /></div>
      <div class="save-status" role="status" aria-live="polite">{{ saveError || saveMessage || '修改后自动保存' }} <el-button v-if="saveError" link @click="autosave.retry">重试保存</el-button></div>
      <!-- 控件完成编辑才提交；不再用独立勾选决定是否保存。 -->
      <PlayerParameterEditor :values="values" :enabled="enabled" :clear="clear" :rows="rows" :namespace="namespace" :user-id="selected" :search="search" :busy="busy || !!error"
        @value="commit" @clear="id => commit(id, '', true)" />
      <el-alert v-if="unknown.length" :title="`此命名空间另有 ${unknown.length} 项扩展参数，保持不变。`" type="info" :closable="false" />
    </el-card>
    <el-dialog v-model="copyDialog" title="复制用户参数" width="min(520px, 95vw)"><el-select v-model="target" filterable placeholder="选择目标用户" :disabled="busy"><el-option v-for="u in users.filter(u => u.id !== selected)" :key="u.id" :label="u.name" :value="u.id" /></el-select><template #footer><el-button :disabled="busy" @click="copyDialog = false">取消</el-button><el-button type="primary" :disabled="!target || busy" @click="copy">确认复制</el-button></template></el-dialog>
  </section>
</template>
<style scoped>
.file-manager{display:grid;gap:16px}.toolbar{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}.toolbar .el-select,.toolbar .el-input{width:280px;max-width:100%}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.field{display:flex;flex-direction:column;align-items:flex-start;gap:8px;min-width:0}.field small{color:var(--el-text-color-secondary);overflow-wrap:anywhere}.field .el-input,.field .el-select,.field .el-input-number{width:100%}.el-alert{margin-bottom:12px}@media(max-width:760px){.fields{grid-template-columns:1fr}}
</style>
