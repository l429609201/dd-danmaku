<script setup>
import { onMounted, ref } from 'vue'
import { api } from './api.js'
const config = ref(null), users = ref([]), busy = ref(false), error = ref(''), message = ref('')
const grants = [
  ['selectionUserIds', '本人临时选择'], ['createSharedUserIds', '创建共享'],
  ['refreshSharedUserIds', '刷新共享同来源同集'], ['replaceSharedUserIds', '明确替换共享'],
  ['uploadSharedUserIds', '上传共享（不授予覆盖权限）'],
]
// 未找到的用户仍提供可取消条目，不能保存时悄悄丢弃现有授权。
function options(key) {
  const known = new Set(users.value.map(u => u.id))
  return [...users.value, ...(config.value?.[key] || []).filter(id => !known.has(id))
    .map(id => ({ id, name: `未找到的用户（${id}）` }))]
}
async function load() {
  busy.value = true; error.value = ''; config.value = null
  try {
    const [policy, accounts] = await Promise.all([api.selectionSettings(), api.users()])
    config.value = policy; users.value = accounts
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
async function save() {
  busy.value = true; error.value = ''; message.value = ''
  try { config.value = await api.saveSelectionSettings(config.value); message.value = '保存策略已更新' }
  catch (e) { error.value = e.message }
  finally { busy.value = false }
}
onMounted(load)
</script>

<template>
  <el-card v-loading="busy" shadow="never">
    <template #header>弹幕选择与保存授权</template>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-alert v-if="message" :title="message" type="success" :closable="false" />
    <el-alert title="到期不主动抓取，仅在下次播放尝试刷新。长期保留不冻结正文；所有写入仍受文件总开关控制。" type="info" :closable="false" />
    <el-form v-if="config" label-position="top" @submit.prevent="save">
      <el-form-item label="共享正文新鲜度（小时）"><el-input-number v-model="config.sharedFreshHours" :min="1" :max="8760" /></el-form-item>
      <el-form-item label="临时正文新鲜度及默认保留（小时）"><el-input-number v-model="config.temporaryHours" :min="1" :max="8760" /></el-form-item>
      <el-form-item label="用户选择默认保留（天）"><el-input-number v-model="config.selectionDays" :min="1" :max="3650" /></el-form-item>
      <el-form-item label="临时缓存容量（MiB）"><el-input-number v-model="config.cacheLimitMiB" :min="32" :max="1048576" /></el-form-item>
      <el-form-item label="每用户选择上限（含长期选择）"><el-input-number v-model="config.selectionLimitPerUser" :min="1" :max="10000" /></el-form-item>
      <el-form-item v-for="[key, label] in grants" :key="key" :label="label">
        <el-select v-model="config[key]" multiple filterable clearable style="width:100%" placeholder="未选择则普通用户无此权限">
          <el-option v-for="user in options(key)" :key="user.id" :label="user.name" :value="user.id" />
        </el-select>
      </el-form-item>
      <el-button type="primary" native-type="submit" :disabled="busy">保存策略</el-button>
    </el-form>
    <el-button :disabled="busy" @click="load">重新读取</el-button>
  </el-card>
</template>
