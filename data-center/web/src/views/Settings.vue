<template>
  <div class="page">
    <h1 class="page-title">系统设置</h1>
    <div v-if="msg" class="tip">{{ msg }}</div>

    <div class="panel">
      <table class="data-table">
        <thead><tr><th>配置项</th><th>值</th><th>说明</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="s in items" :key="s.key">
            <td class="key">{{ s.key }}</td>
            <td>
              <input v-model="s.value" class="input" :type="s.is_secret ? 'password' : 'text'" />
            </td>
            <td>{{ s.description || '—' }}</td>
            <td><button class="link" @click="save(s)">保存</button></td>
          </tr>
          <tr v-if="!items.length"><td colspan="4" class="empty">暂无配置</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'Settings',
  setup() {
    const items = ref([])
    const msg = ref('')

    const load = async () => {
      msg.value = ''
      try {
        const res = await apiV2('/settings')
        items.value = res.data || []
      } catch (e) { msg.value = e.message }
    }

    const save = async (s) => {
      try {
        await apiV2(`/settings/${encodeURIComponent(s.key)}`, { method: 'PUT', body: { value: s.value } })
        msg.value = `已保存 ${s.key}`
      } catch (e) { msg.value = e.message }
    }

    onMounted(load)
    return { items, msg, save }
  }
}
</script>

<style scoped>
.page { padding: 24px; }
.page-title { font-size: 22px; margin-bottom: 20px; color: #333; }
.tip { background: #e6f4ff; border: 1px solid #91caff; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; color: #0958d9; }
.panel { background: #fff; border-radius: 10px; padding: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
.data-table th { color: #888; font-weight: 500; }
.key { font-family: monospace; font-size: 12px; }
.input { padding: 6px 10px; border: 1px solid #d9d9d9; border-radius: 6px; min-width: 240px; }
.link { background: none; border: none; color: #1677ff; cursor: pointer; font-size: 13px; }
.empty { text-align: center; color: #999; padding: 20px; }
</style>