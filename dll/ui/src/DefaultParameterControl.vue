<script setup>
import { computed, ref } from 'vue'
import { parameterFields } from './parameterFields.js'
import PlayerListEditor from './PlayerListEditor.vue'
// 控件只负责展示和编辑，继承与持久化仍由父页面处理。
const props = defineProps({ field: Array, value: [String, Number, Boolean, Array], options: Array, custom: Boolean, origin: String })
const emit = defineEmits(['update', 'custom'])
const definition = computed(() => parameterFields.find(item => item.key === props.field[0]))
const secret = computed(() => /token|apikey|secret|password/i.test(props.field[0]))
const reveal = ref(false)
function checkOption(value, id, checked) {
  emit('update', checked ? [...value, id] : value.filter(item => item !== id))
}
</script>

<template>
  <!-- 修改继承值即建立覆盖，只有恢复继承需要独立操作。 -->
  <div class="parameter" :class="{ checks: Array.isArray(field[2]) }">
    <div class="control">
      <label v-if="typeof field[2] === 'boolean'" class="check"><input type="checkbox" :checked="value" @change="emit('update', $event.target.checked)">{{ field[1] }}</label>
      <template v-else>
        <label :for="`default-${field[0]}`">{{ field[1] }}</label>
        <div v-if="Array.isArray(field[2])" class="checkbox-list" role="group" :aria-label="field[1]"><label v-for="[id, title] in options" :key="id" class="check"><input type="checkbox" :checked="value.includes(id)" @change="checkOption(value, id, $event.target.checked)">{{ title }}</label></div>
        <template v-else-if="typeof field[2] === 'number' && field[3] != null && field[4] != null && field[0] !== 'chConvert'">
          <input :id="`default-${field[0]}`" type="range" :min="field[3]" :max="field[4]" step="1" :value="value" @change="emit('update', Number($event.target.value))">
          <output>{{ options.find(([id]) => id === value)?.[1] ?? value }}</output>
        </template>
        <div v-else-if="options.length" class="segments"><button v-for="[id, title] in options" :key="id" type="button" :aria-pressed="value === id" @click="emit('update', id)">{{ title }}</button></div>
        <input v-else-if="typeof field[2] === 'number'" :id="`default-${field[0]}`" type="number" :value="value" @change="emit('update', $event.target.value === '' ? NaN : Number($event.target.value))">
        <PlayerListEditor v-else-if="field[0] === 'excludedLibraries'" :kind="field[0]" :model-value="value" @update:model-value="v => emit('update', v)" />
        <textarea v-else-if="definition.type === 'json'" :id="`default-${field[0]}`" :value="value" rows="5" @change="emit('update', $event.target.value)" />
        <textarea v-else-if="['filterKeywords', 'animeTitleBlacklist', 'episodeTitleBlacklist'].includes(field[0])" :id="`default-${field[0]}`" :value="value" maxlength="8192" rows="3" @change="emit('update', $event.target.value)" />
        <input v-else :id="`default-${field[0]}`" :type="secret && !reveal ? 'password' : 'text'" :value="value" :maxlength="field[0] === 'fontFamily' ? 256 : 8192" autocomplete="off" @change="emit('update', $event.target.value)" @keydown.enter="$event.target.blur()">
        <button v-if="secret" type="button" :aria-pressed="reveal" @click="reveal = !reveal">{{ reveal ? '隐藏' : '显示' }}</button>
      </template>
      <button v-if="custom" type="button" class="clear-secret" :title="`恢复${origin}`" @click="emit('custom', false)">继承</button><small v-else :title="origin">继承</small>
    </div>
  </div>
</template>

<style scoped>
.parameter { padding: 8px 0; }
.control { display: flex; align-items: center; gap: 12px; min-height: 30px; }
.control > label:not(.check) { flex: 0 0 8.5em; font-size: 14px; }
.control > input[type=range] { flex: 1; min-width: 0; padding: 0; }
output { min-width: 4.5em; text-align: right; font-size: 13px; }
input { accent-color: var(--el-color-primary); }
input[type=checkbox] { width: 16px; height: 16px; margin: 0; }
.check { display: inline-flex; align-items: center; gap: 7px; font-size: 14px; }
.checkbox-list { display: flex; flex-wrap: wrap; gap: 12px 18px; }
.checks .control { align-items: flex-start; }
.inherit { display: flex; align-items: center; gap: 5px; margin-top: 5px; color: var(--el-text-color-secondary); font-size: 12px; }
.inherit input { width: 12px; height: 12px; }
select, textarea, input[type=text], input[type=password], input[type=number] { box-sizing: border-box; flex: 1; min-width: 0; width: 100%; padding: 7px 9px; border: 1px solid var(--el-border-color); border-radius: 4px; background: var(--el-bg-color); color: var(--el-text-color-primary); font: inherit; }
textarea { resize: vertical; }
input:disabled, select:disabled, textarea:disabled { opacity: .55; cursor: not-allowed; }
input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; }
@media (max-width: 540px) { .control { flex-wrap: wrap; } .checks .control > label { flex-basis: 100%; } .control > label:not(.check) { flex-basis: 7em; } }
</style>
