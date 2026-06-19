<template>
  <div class="page">
    <h1 class="page-title">Worker 控制</h1>
    <div class="toolbar">
      <button class="btn" @click="load">刷新</button>
      <button class="btn btn-primary" @click="reconnect">手动重连</button>
      <span class="live" :class="liveConnected ? 'on' : 'off'">
        实时连接: {{ liveConnected ? '已连接' : '未连接' }}
      </span>
    </div>

    <div v-if="msg" class="tip">{{ msg }}</div>

    <!-- 节点状态 -->
    <div class="panel">
      <h2 class="panel-title">长连接节点</h2>
      <table class="data-table">
        <thead><tr><th>节点</th><th>Worker</th><th>状态</th><th>最近心跳</th><th>重连次数</th><th>错误</th></tr></thead>
        <tbody>
          <tr v-for="n in nodes" :key="n.id">
            <td>{{ n.node_id }}</td>
            <td>{{ n.worker_id }}</td>
            <td><span :class="n.connected ? 'badge-ok' : 'badge-off'">{{ n.connected ? '在线' : '离线' }}</span></td>
            <td>{{ fmt(n.last_seen_at) }}</td>
            <td>{{ n.reconnect_count }}</td>
            <td class="err">{{ n.last_error || '—' }}</td>
          </tr>
          <tr v-if="!nodes.length"><td colspan="6" class="empty">暂无节点</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 消息审计 -->
    <div class="panel">
      <h2 class="panel-title">消息审计（最近 50 条）</h2>
      <table class="data-table">
        <thead><tr><th>方向</th><th>类型</th><th>状态</th><th>cache_key</th><th>耗时</th><th>时间</th></tr></thead>
        <tbody>
          <tr v-for="m in messages" :key="m.id">
            <td>{{ m.direction }}</td>
            <td>{{ m.message_type }}</td>
            <td>{{ m.status }}</td>
            <td class="key">{{ m.request_cache_key || '—' }}</td>
            <td>{{ m.duration_ms }}ms</td>
            <td>{{ fmt(m.created_at) }}</td>
          </tr>
          <tr v-if="!messages.length"><td colspan="6" class="empty">暂无消息</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'Control',
  setup() {
    const nodes = ref([])
    const messages = ref([])
    const liveConnected = ref(false)
    const msg = ref('')

    const load = async () => {
      try {
        const res = await apiV2('/control/nodes')
        nodes.value = res.data.nodes || []
        liveConnected.value = !!res.data.live_connected
        const m = await apiV2('/control/messages?page=1&page_size=50')
        messages.value = m.items || []
      } catch (e) {
        msg.value = e.message
      }
    }

    const reconnect = async () => {
      msg.value = ''
      try {
        const res = await apiV2('/control/reconnect', { method: 'POST' })
        msg.value = res.message || '已触发重连'
        setTimeout(load, 1000)
      } catch (e) {
        msg.value = e.message
      }
    }

    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')
    onMounted(load)
    return { nodes, messages, liveConnected, msg, load, reconnect, fmt }
  }
}
</script>

<style scoped>
.page { padding: 24px; }
.page-title { font-size: 22px; margin-bottom: 20px; color: #333; }
.toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.btn { padding: 8px 16px; border: 1px solid #d9d9d9; background: #fff; border-radius: 6px; cursor: pointer; }
.btn-primary { background: #1677ff; color: #fff; border-color: #1677ff; }
.live.on { color: #52c41a; }
.live.off { color: #999; }
.tip { background: #e6f4ff; border: 1px solid #91caff; padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; color: #0958d9; }
.panel { background: #fff; border-radius: 10px; padding: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); margin-bottom: 20px; }
.panel-title { font-size: 16px; margin-bottom: 14px; color: #333; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
.data-table th { color: #888; font-weight: 500; }
.badge-ok { color: #52c41a; }
.badge-off { color: #999; }
.err { color: #d4380d; max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
.key { font-family: monospace; font-size: 12px; max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
.empty { text-align: center; color: #999; padding: 20px; }
</style>