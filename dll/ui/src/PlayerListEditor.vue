<script setup>
import { computed, onMounted, ref } from 'vue'
import { api } from './api.js'
const props = defineProps({ modelValue: String, kind: String, disabled: Boolean })
const emit = defineEmits(['update:modelValue'])
const names = ref([]), error = ref('')
const items = computed(() => {
  try { const v = JSON.parse(props.modelValue); return Array.isArray(v) && v.every(x => typeof x === 'string') ? v : null } catch { return null }
})
// 播放器排除规则保存媒体库名称而不是 ID，不能复用扫描范围的 ID 保存逻辑。
const options = computed(() => [...new Set([...(props.kind === 'excludedLibraries' ? names.value : ['official', 'custom']), ...(items.value || [])])])
async function load() {
  if (props.kind !== 'excludedLibraries') return
  try { const data = await api.scanScope(); names.value = data.libraries.map(v => v.name); error.value = '' }
  catch { error.value = '媒体库列表读取失败，已保存的选择仍保留。' }
}
function toggle(name, checked) { emit('update:modelValue', JSON.stringify(checked ? [...items.value, name] : items.value.filter(v => v !== name))) }
function move(index, delta) {
  const list = [...items.value], to = index + delta
  if (to < 0 || to >= list.length) return
  ;[list[index], list[to]] = [list[to], list[index]]
  emit('update:modelValue', JSON.stringify(list))
}
function label(name) { return props.kind === 'apiPriority' ? ({ official: '弹弹play', custom: '自定义源' }[name] || name) : name }
onMounted(load)
</script>
<template>
  <div class="list">
    <p v-if="items === null" role="alert">列表格式无效，已保留原数据，请通过原始参数管理修复。</p>
    <template v-else>
      <p v-if="error" role="alert">{{ error }} <button type="button" :disabled="disabled" @click="load">重试</button></p>
      <p>{{ kind === 'excludedLibraries' ? '勾选不需要加载弹幕的媒体库：' : '勾选参与匹配的接口，并调整搜索优先级：' }}</p>
      <label v-for="name in options" :key="name"><input type="checkbox" :checked="items.includes(name)" :disabled="disabled" @change="toggle(name, $event.target.checked)">{{ label(name) }}</label>
      <ol v-if="kind === 'apiPriority'"><li v-for="(name, index) in items" :key="`${index}:${name}`">{{ label(name) }} <button type="button" :disabled="disabled || index === 0" @click="move(index, -1)">上移</button> <button type="button" :disabled="disabled || index === items.length - 1" @click="move(index, 1)">下移</button></li></ol>
    </template>
  </div>
</template>
<style scoped>
.list { width: 100%; }label { display: inline-flex; align-items: center; gap: 5px; margin: 6px 16px 6px 0; }p { font-size: 13px; color: var(--el-text-color-secondary); }li { padding: 5px; }input { accent-color: var(--el-color-primary); }button { padding: 5px 8px; background: var(--el-bg-color); color: var(--el-text-color-primary); border: 1px solid var(--el-border-color); border-radius: 3px; }:disabled { opacity: .55; }
</style>
