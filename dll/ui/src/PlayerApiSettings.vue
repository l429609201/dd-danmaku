<script setup>
import { computed } from 'vue'
import PlayerSourceEditor from './PlayerSourceEditor.vue'
// 两种管理页面共用原版控制栏；继承和敏感清除由宿主页插槽负责。
const props = defineProps({ official: Boolean, custom: Boolean, priority: String, sources: String, saved: String, disabled: Boolean })
const emit = defineEmits(['change'])
const officialFirst = computed(() => {
  try { return JSON.parse(props.priority || '["official","custom"]')[0] === 'official' }
  catch { return true }
})
function switchPriority() {
  emit('change', 'apiPriority', JSON.stringify(officialFirst.value ? ['custom', 'official'] : ['official', 'custom']))
}
</script>
<template>
  <div class="api-settings">
    <div class="control-bar">
      <div class="priority"><span>优先级:</span><button type="button" class="priority-switch" :disabled="disabled" :aria-label="`优先使用${officialFirst ? '弹弹play' : '自定义'}，点击切换`" @click="switchPriority"><span>自定义</span><span>弹弹play</span><span class="slider" :class="{ official: officialFirst }">{{ officialFirst ? '弹弹play' : '自定义' }}</span></button></div>
      <label><input type="checkbox" :checked="official" :disabled="disabled" @change="emit('change', 'useOfficialApi', $event.target.checked)">启用弹弹play</label>
      <label><input type="checkbox" :checked="custom" :disabled="disabled" @change="emit('change', 'useCustomApi', $event.target.checked)">启用自定义</label>
    </div>
    <slot name="origins" />
    <!-- 原版关闭自定义后保留内容但禁止操作，fieldset 同时覆盖键盘交互。 -->
    <fieldset :disabled="disabled || !custom" :class="{ inactive: !custom }">
      <PlayerSourceEditor :model-value="sources" :saved="saved" :disabled="disabled || !custom" @update:model-value="value => emit('change', 'customApiList', value)" />
      <slot name="sources-footer" />
    </fieldset>
  </div>
</template>
<style scoped>
.control-bar, .priority { display: flex; align-items: center; gap: 15px; }.control-bar { flex-wrap: wrap; margin-bottom: 1em; }.priority { gap: 8px; }.control-bar label { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }.control-bar input { accent-color: #52b54b; }
.priority-switch { position: relative; display: flex; align-items: center; justify-content: space-around; width: 160px; height: 32px; padding: 0; border: 0; border-radius: 16px; background: #333; color: #999; cursor: pointer; font-size: 11px; flex-shrink: 0; }.slider { position: absolute; top: 2px; left: 2px; width: 80px; height: 28px; display: flex; align-items: center; justify-content: center; background: #4a90e2; border-radius: 14px; color: white; font-size: 12px; font-weight: bold; transition: left .3s; }.slider.official { left: 78px; }
fieldset { border: 0; padding: 0; margin: 1em 0 0; min-width: 0; }.inactive { opacity: .5; }:disabled { cursor: not-allowed; }button:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
</style>
