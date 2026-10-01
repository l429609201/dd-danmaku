<script setup>
import { ref } from 'vue'
const props = defineProps({ source: Object, disabled: Boolean, editing: Boolean })
const emit = defineEmits(['submit', 'cancel', 'proxy'])
// 草稿与保存值隔离；关闭认证开关只在明确保存时清除凭据。
const draft = ref({ name: '', url: '', enabled: true, appId: '', appSecret: '', ...props.source })
const auth = ref(Boolean(draft.value.appId && draft.value.appSecret)), reveal = ref(false), error = ref('')
function onEnter(event) {
  if (event.target.tagName !== 'INPUT') return
  event.preventDefault()
  if (!props.disabled) submit()
}
function submit() {
  const value = { ...draft.value, name: draft.value.name.trim(), url: draft.value.url.trim().replace(/\/+$/, ''), appId: auth.value ? draft.value.appId.trim() : '', appSecret: auth.value ? draft.value.appSecret.trim() : '' }
  if (!value.name) { error.value = '请输入源名称'; return }
  try { if (!['http:', 'https:'].includes(new URL(value.url).protocol)) throw new Error() }
  catch { error.value = '请输入有效的 HTTP 或 HTTPS 接口地址'; return }
  if (auth.value && (!value.appId || !value.appSecret)) { error.value = '开启自定义 key 后，请填写 AppId 和 AppSecret'; return }
  if (props.editing && !auth.value && (props.source.appId || props.source.appSecret) && !window.confirm('确认清除此源已保存的 AppId 和 AppSecret？')) return
  error.value = ''; emit('submit', value)
}
</script>
<template>
  <div class="source-form" :class="{ editing }" @keydown.enter="onEnter">
    <div class="pair identity"><label>源名称<input v-model="draft.name" :disabled="disabled" placeholder="必填"></label><label>API 地址<input v-model="draft.url" :disabled="disabled" placeholder="http://" autocomplete="off"></label></div>
    <div v-if="auth" class="pair"><label>AppId<input v-model="draft.appId" :disabled="disabled" placeholder="必填" autocomplete="off"></label><label>AppSecret<input v-model="draft.appSecret" :disabled="disabled" :type="reveal ? 'text' : 'password'" placeholder="必填" autocomplete="new-password"></label></div>
    <div class="bottom"><button type="button" class="toggle" role="switch" aria-label="自定义弹弹官方key" :aria-checked="auth" :disabled="disabled" @click="auth = !auth"><span /></button><span>自定义弹弹官方key</span><button v-if="auth" type="button" :disabled="disabled" :aria-pressed="reveal" @click="reveal = !reveal">{{ reveal ? '隐藏' : '显示' }}</button><div class="actions"><button v-if="!editing" class="proxy" type="button" title="添加本地 Emby DLL 后端中转" aria-label="添加本地 Emby DLL 后端中转" :disabled="disabled" @click="emit('proxy', draft.name.trim())">Emby 中转</button><button class="submit" type="button" :disabled="disabled" @click="submit">{{ disabled ? '处理中…' : editing ? '保存' : '添加' }}</button><button v-if="editing" type="button" :disabled="disabled" @click="emit('cancel')">取消</button></div></div>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>
<style scoped>
/* 按原版 4:6 添加区、卡片编辑行和底部认证开关排布。 */
.source-form { background: rgba(0,0,0,.12); padding: 1em; border-radius: 4px; }
.pair { display: grid; grid-template-columns: 4fr 6fr; gap: .5em; margin-bottom: .5em; }
label { min-width: 0; font-size: .82em; color: var(--el-text-color-secondary); }
input { display: block; box-sizing: border-box; width: 100%; min-width: 0; margin-top: .3em; padding: .5em; border: 1px solid var(--el-border-color); border-radius: 4px; background: var(--el-bg-color); color: var(--el-text-color-primary); }
.bottom { display: flex; flex-wrap: wrap; align-items: center; gap: .5em; font-size: .85em; }.actions { display: flex; align-items: center; gap: .5em; margin-left: auto; flex: 0 0 auto; }.actions button { white-space: nowrap; }.proxy { font-size: .9em; }
button { cursor: pointer; padding: .4em .6em; border: 1px solid var(--el-border-color); border-radius: 4px; background: var(--el-bg-color); color: inherit; }
.toggle { position: relative; width: 2.8em; height: 1.55em; padding: 0; flex: none; border: 0; border-radius: 1em; background: #888; }.toggle span { position: absolute; top: .18em; left: .18em; width: 1.2em; height: 1.2em; border-radius: 50%; background: white; }.toggle[aria-checked=true] { background: #52b54b; }.toggle[aria-checked=true] span { left: 1.42em; }
.editing .identity { grid-template-columns: 1fr; }.editing .identity label { display: flex; align-items: center; gap: .5em; }.editing .identity input { flex: 1; width: 0; margin: 0; }
:disabled { opacity: .55; cursor: not-allowed; }:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }p { color: var(--el-color-danger); }
/* 小屏将源名称、地址与凭据逐行排列，编辑状态不再压缩输入框。 */
@media (max-width: 560px) {
  .source-form { padding: .75em; }
  .pair { grid-template-columns: minmax(0, 1fr); gap: .75em; }
  .editing .identity label { display: block; }
  .editing .identity input { width: 100%; margin-top: .3em; }
  .bottom { font-size: 1em; }
  .actions { max-width: 100%; }
  .toggle::before { content: ''; position: absolute; inset: -12px -4px; }
}
</style>
