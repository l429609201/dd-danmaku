<script setup>
import { computed, ref } from 'vue'
import { api } from './api.js'
const props = defineProps({ userId: String, files: Array, disabled: Boolean })
const emit = defineEmits(['converted'])
const busy = ref(false), error = ref('')
const current = computed(() => props.files?.find(file => file.userId === props.userId))
async function convert() {
  if (!current.value?.legacy || busy.value) return
  busy.value = true; error.value = ''
  try {
    await api.convertParameterFile(props.userId)
    emit('converted')
  } catch (e) { error.value = e.message }
  finally { busy.value = false }
}
</script>
<template>
  <div>
    <!-- 以服务器文件状态为准；转换成功后不可关闭，避免旧数据重新生效。 -->
    <el-switch :model-value="!!current && !current.legacy" active-text="转换为新格式"
      :loading="busy" :disabled="disabled || busy || !current?.legacy" @change="convert" />
    <!-- 迁移只处理服务器已保存的数据，并明确新旧文件的安全边界。 -->
    <p>迁移当前用户完整参数到 DD.Danmaku/Users；新文件成功创建后删除对应旧文件，不覆盖已有新文件。发现多份旧文件时拒绝自动迁移，请先备份并处理冲突。迁移前请停用旧参数持久化插件，避免继续写入旧路径；不包含尚未保存的表单修改。</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
  </div>
</template>
