import { ref } from 'vue'

// 串行提交快照；失败保留待提交内容，不把旧请求的完成状态覆盖到新草稿。
export function useParameterAutosave(write) {
  const saving = ref(false), error = ref(''), message = ref('')
  const pending = new Map()
  async function flush() {
    if (saving.value || !pending.size) return
    saving.value = true; error.value = ''; message.value = '正在保存…'
    try {
      while (pending.size) {
        const [key, value] = pending.entries().next().value
        await write(value)
        if (pending.get(key) === value) pending.delete(key)
      }
      message.value = '已自动保存'
    } catch (e) { error.value = `保存失败：${e.message}；修改已保留，请重试`; message.value = '' }
    finally { saving.value = false }
  }
  function submit(key, value) { pending.set(key, value); if (!error.value) void flush() }
  return { saving, error, message, submit, retry: flush, hasPending: () => pending.size > 0 }
}
