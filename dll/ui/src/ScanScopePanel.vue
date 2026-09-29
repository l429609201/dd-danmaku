<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { api } from './api.js'
const emit = defineEmits(['ready'])
const libraries = ref([]), selected = ref([]), baseline = ref([]), ready = ref(false), busy = ref(false), error = ref(''), saved = ref(false)
// 未加载或存在未保存草稿时禁止启动，防止错误范围被当成全库。
const clean = computed(() => JSON.stringify([...selected.value].sort()) === JSON.stringify([...baseline.value].sort()))
watch(() => ready.value && !busy.value && clean.value, value => emit('ready', value), { immediate: true })
async function load() {
  busy.value = true; error.value = ''; ready.value = false
  try {
    const data = await api.scanScope()
    if (!Array.isArray(data?.libraries) || !Array.isArray(data?.libraryIds)) throw new Error('扫描范围接口结构无效，请检查后端 DLL 版本及 /library-scan/scope 响应')
    libraries.value = data.libraries; selected.value = [...data.libraryIds]; baseline.value = [...data.libraryIds]; ready.value = true
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
async function save() {
  if (busy.value || !ready.value) return
  busy.value = true; error.value = ''; saved.value = false
  try {
    const data = await api.saveScanScope([...selected.value])
    if (!Array.isArray(data?.libraryIds)) throw new Error('保存回包无效，请重新读取确认服务器范围')
    selected.value = [...data.libraryIds]; baseline.value = [...data.libraryIds]; saved.value = true
  } catch (e) { error.value = e.message; ready.value = false }
  finally { busy.value = false }
}
onMounted(load)
</script>
<template>
  <!-- 独立编辑草稿，不让仪表盘轮询覆盖未保存选择。 -->
  <div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-form-item label="扫描媒体库">
      <el-select v-model="selected" multiple collapse-tags collapse-tags-tooltip clearable :placeholder="ready ? '全部媒体库（不选择）' : '扫描范围未加载'" :disabled="busy || !ready" style="width: min(100%, 420px)" @change="saved = false">
        <el-option v-for="library in libraries" :key="library.id" :label="library.name" :value="library.id" />
      </el-select>
      <el-button :disabled="busy || !ready" @click="save">保存扫描范围</el-button>
      <el-button v-if="!ready" :disabled="busy" @click="load">重新加载</el-button>
      <span v-if="saved">范围已保存</span>
    </el-form-item>
    <p>留空扫描全部媒体库；修改后请先保存，再立即扫描。手动和定时任务共用此范围。</p>
  </div>
</template>
