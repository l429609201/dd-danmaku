<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { Check, Refresh } from '@element-plus/icons-vue'
import { api } from './api.js'

const config = ref(null), users = ref([]), busy = ref(false), confirming = ref(false)
const error = ref(''), message = ref(''), savedSnapshot = ref('')
const playbackFields = [
  ['enabled', 'XML 联动总开关'], ['readEnabled', '允许读取 XML'],
  ['writeEnabled', '允许写入 XML'], ['preferLocal', '优先本地 XML'],
  ['autoSave', '旧参数：自动保存'],
]
const retentionFields = [
  ['sharedFreshHours', '共享新鲜度（小时）', 1, 8760],
  ['temporaryHours', '临时保留（小时）', 1, 8760],
  ['selectionDays', '选择保留（天）', 1, 3650],
  ['cacheLimitMiB', '临时容量（MiB）', 32, 1048576],
  ['selectionLimitPerUser', '每用户选择上限', 1, 10000],
]
const disabled = computed(() => busy.value || confirming.value)
const dirty = computed(() => config.value !== null && JSON.stringify(config.value) !== savedSnapshot.value)
let sequence = 0, controller, disposed = false

// 完整字段按固定顺序克隆，不补默认值，也不调整现有用户授权。
// 版本标识原样往返，由后端拒绝过期草稿覆盖其他管理员的更改。
function cloneSettings(data) {
  if (!data?.playback || !data?.retention || !data?.authorization
    || typeof data.revision !== 'string' || !data.revision.trim()
    || playbackFields.some(([key]) => typeof data.playback[key] !== 'boolean')
    || retentionFields.some(([key]) => !Number.isFinite(data.retention[key]))
    || typeof data.authorization.administratorEnabled !== 'boolean'
    || typeof data.authorization.allowOverwrite !== 'boolean'
    || !Array.isArray(data.authorization.userIds)
    || data.authorization.userIds.some(id => typeof id !== 'string')) {
    throw new Error('弹幕存储与授权设置无效，请检查完整配置')
  }
  return JSON.parse(JSON.stringify({
    playback: Object.fromEntries(playbackFields.map(([key]) => [key, data.playback[key]])),
    retention: Object.fromEntries(retentionFields.map(([key]) => [key, data.retention[key]])),
    authorization: {
      administratorEnabled: data.authorization.administratorEnabled,
      userIds: [...data.authorization.userIds],
      allowOverwrite: data.authorization.allowOverwrite,
    },
    revision: data.revision,
  }))
}

// 粗粒度授权不自动分配角色；管理员开关独立于普通用户名单，保留已有异常授权供移除。
function options() {
  const selected = new Set(config.value.authorization.userIds)
  const known = new Set(users.value.map(user => user.id))
  return [...users.value.filter(user => user.isAdministrator === false || selected.has(user.id))
    .map(user => ({
      ...user,
      name: `${user.name}${user.isAdministrator ? '（管理员）' : ''}${user.isDisabled ? '（已停用）' : ''}`,
    })), ...config.value.authorization.userIds.filter(id => !known.has(id))
    .map(id => ({ id, name: `未找到的用户（${id}）` }))]
}
function switchDisabled(key) {
  const playback = config.value.playback
  return key !== 'enabled' && (!playback.enabled
    || (key === 'preferLocal' && !playback.readEnabled)
    || (key === 'autoSave' && !playback.writeEnabled))
}
async function load() {
  if (disabled.value || disposed) return
  const current = ++sequence
  controller = new AbortController()
  busy.value = true; error.value = ''; message.value = ''; config.value = null; users.value = []
  try {
    const [settings, accounts] = await Promise.all([
      api.storageSettings(controller.signal), api.users(controller.signal),
    ])
    if (disposed || current !== sequence) return
    const next = cloneSettings(settings)
    if (!Array.isArray(accounts) || accounts.some(user => typeof user?.id !== 'string'
      || typeof user?.name !== 'string' || typeof user?.isAdministrator !== 'boolean'
      || (user.isDisabled !== undefined && typeof user.isDisabled !== 'boolean'))) {
      throw new Error('用户列表响应无效')
    }
    config.value = next; users.value = accounts; savedSnapshot.value = JSON.stringify(next)
  } catch (e) {
    if (!disposed && current === sequence) error.value = e.message
  } finally {
    if (!disposed && current === sequence) { busy.value = false; controller = undefined }
  }
}
async function refresh() {
  if (disabled.value || disposed) return
  if (dirty.value) {
    confirming.value = true
    try {
      await ElMessageBox.confirm('有未保存的更改，是否重新读取并放弃更改？', '重新读取设置', {
        confirmButtonText: '重新读取', cancelButtonText: '保留更改', type: 'warning',
      })
    } catch { return }
    finally { confirming.value = false }
  }
  await load()
}
async function save() {
  if (disabled.value || !config.value || disposed) return
  const current = ++sequence
  controller = new AbortController()
  busy.value = true; error.value = ''; message.value = ''
  try {
    const data = await api.saveStorageSettings(cloneSettings(config.value), controller.signal)
    if (disposed || current !== sequence) return
    const next = cloneSettings(data)
    config.value = next; savedSnapshot.value = JSON.stringify(next); message.value = '弹幕存储与授权已保存'
  } catch (e) {
    // 保存失败保留完整草稿，允许修正或直接重试。
    if (!disposed && current === sequence) error.value = e.message
  } finally {
    if (!disposed && current === sequence) { busy.value = false; controller = undefined }
  }
}
onMounted(load)
// KeepAlive 切页保留草稿；仅真正卸载时取消请求并使迟到回包失效。
onBeforeUnmount(() => { disposed = true; sequence++; controller?.abort() })
</script>

<template>
  <el-card shadow="never" class="storage-settings" aria-labelledby="storage-settings-title" v-loading="busy">
    <template #header>
      <header class="storage-header">
        <h2 id="storage-settings-title">弹幕存储与授权</h2>
        <div class="storage-actions">
          <el-tooltip content="保存" placement="top">
            <el-button type="primary" :icon="Check" :disabled="disabled || !config" aria-label="保存弹幕存储与授权" @click="save" />
          </el-tooltip>
          <el-tooltip content="重新读取" placement="top">
            <el-button :icon="Refresh" :disabled="disabled" aria-label="重新读取弹幕存储与授权" @click="refresh" />
          </el-tooltip>
        </div>
      </header>
    </template>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-alert v-if="message && !dirty" :title="message" type="success" :closable="false" />
    <el-form v-if="config" class="storage-form" label-width="150px" :disabled="disabled" @submit.prevent="save">
      <section class="storage-group" aria-labelledby="storage-xml-title">
        <h3 id="storage-xml-title">XML 策略</h3>
        <p>自动播放不保存 XML；旧自动保存参数不用于本播放链路。手动选择可缓存本人选择；写入共享 XML 是另一个需授权的显式保存操作。</p>
        <div class="storage-grid">
          <el-form-item v-for="[key, label] in playbackFields" :key="key" :label="label">
            <el-switch v-model="config.playback[key]" :aria-label="label" inline-prompt active-text="开" inactive-text="关" :width="52" :disabled="switchDisabled(key)" />
          </el-form-item>
        </div>
      </section>
      <section class="storage-group" aria-labelledby="storage-grants-title">
        <h3 id="storage-grants-title">用户授权</h3>
        <div class="storage-grid">
          <el-form-item label="允许管理员保存">
            <el-switch v-model="config.authorization.administratorEnabled" aria-label="允许管理员保存" inline-prompt active-text="开" inactive-text="关" :width="52" />
          </el-form-item>
          <el-form-item label="允许覆盖已有 XML">
            <template #label>
              <el-tooltip content="仅授权的显式共享 XML 保存可覆盖，仍需确认与版本校验；不影响本人选择缓存。" placement="top"><span>允许覆盖已有 XML</span></el-tooltip>
            </template>
            <el-switch v-model="config.authorization.allowOverwrite" aria-label="允许覆盖已有 XML" inline-prompt active-text="开" inactive-text="关" :width="52" />
          </el-form-item>
          <el-form-item label="普通用户授权" class="grant-row">
            <el-select v-model="config.authorization.userIds" aria-label="普通用户授权" multiple filterable clearable fit-input-width collapse-tags collapse-tags-tooltip :max-collapse-tags="1" placeholder="未授权">
              <el-option v-for="user in options()" :key="user.id" :label="user.name" :title="user.name" :value="user.id" />
            </el-select>
          </el-form-item>
        </div>
      </section>
      <section class="storage-group" aria-labelledby="storage-retention-title">
        <h3 id="storage-retention-title">缓存保留</h3>
        <div class="storage-grid">
          <el-form-item v-for="[key, label, min, max] in retentionFields" :key="key" :label="label">
            <el-input-number v-model="config.retention[key]" :aria-label="label" :min="min" :max="max" controls-position="right" />
          </el-form-item>
        </div>
      </section>
    </el-form>
  </el-card>
</template>

<style scoped>
.storage-settings { min-width: 0; }
.storage-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.storage-header h2 { margin: 0; font-size: 16px; line-height: 24px; font-weight: 600; }
.storage-actions { display: flex; align-items: center; flex-shrink: 0; gap: 8px; }
.storage-actions .el-button + .el-button { margin-left: 0; }
.storage-settings :deep(.el-card__body) { min-width: 0; }
.storage-settings :deep(.el-alert) { margin-bottom: 12px; }
.storage-group { border-top: 1px solid var(--el-border-color-light); padding: 12px 0 4px; }
.storage-group:first-child { border-top: 0; padding-top: 0; }
.storage-group h3 { margin: 0 0 10px; font-size: 14px; line-height: 20px; font-weight: 600; }
.storage-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 24px; }
.storage-grid .el-form-item { min-width: 0; margin-bottom: 10px; }
.storage-grid :deep(.el-form-item__content) { min-width: 0; }
.storage-grid :deep(.el-form-item__label) { flex-shrink: 0; }
.storage-grid .el-input-number { width: 164px; max-width: 100%; }
.grant-row { grid-column: 1 / -1; }
.grant-row .el-select { width: 100%; max-width: 600px; min-width: 0; }
.grant-row :deep(.el-select__selection) { flex-wrap: nowrap; min-width: 0; }
.grant-row :deep(.el-select__selected-item) { min-width: 0; max-width: 100%; }
.grant-row :deep(.el-tag__content) { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 760px) {
  .storage-grid { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 380px) {
  .storage-header { flex-wrap: wrap; }
  .storage-grid :deep(.el-form-item) { display: block; }
  .storage-grid :deep(.el-form-item__label) { display: block; width: auto !important; padding: 0; text-align: left; }
  .storage-grid :deep(.el-form-item__content) { margin-left: 0 !important; }
}
</style>
