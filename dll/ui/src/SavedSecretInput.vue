<script setup>
import { onDeactivated, ref, watch } from 'vue'
const props = defineProps({ value: { type: String, default: '' }, modelValue: { type: String, default: '' }, disabled: Boolean, commitOnChange: Boolean })
const emit = defineEmits(['update:modelValue'])
const visible = ref(false), text = ref(props.modelValue || props.value)
// 参数页完成编辑再提交；其他设置页维持原有草稿事件。
function edit(value) { text.value = value; if (!props.commitOnChange) emit('update:modelValue', value) }
function commit() { if (props.commitOnChange) emit('update:modelValue', text.value) }
onDeactivated(() => { visible.value = false })
watch(() => props.value, value => { if (!props.modelValue) text.value = value; visible.value = false })
watch(() => props.modelValue, value => { text.value = value || props.value })
watch(() => props.disabled, () => { visible.value = false })
</script>
<template>
  <div class="saved-secret">
    <el-input :model-value="text" @update:model-value="edit" @change="commit" @keydown.enter="$event.target.blur()" :type="visible ? 'text' : 'password'" :disabled="disabled" autocomplete="new-password" aria-label="敏感值" placeholder="留空保留；删除请使用清除操作" />
    <el-button :disabled="disabled" :aria-pressed="visible" @click="visible = !visible">{{ visible ? '隐藏' : '显示' }}</el-button>
  </div>
</template>
<style scoped>
.saved-secret { display: flex; width: 100%; gap: 8px; margin-bottom: 8px; }
.saved-secret .el-input { flex: 1; min-width: 0; }
</style>
