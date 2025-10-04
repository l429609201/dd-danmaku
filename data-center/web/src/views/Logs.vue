<template>
  <div class="logs-page">
    <div class="page-header">
      <h1>📋 日志管理</h1>
      <p>查看和管理系统日志</p>
    </div>

    <div class="log-controls">
      <div class="filter-group">
        <label>日志级别:</label>
        <select v-model="selectedLevel" @change="filterLogs">
          <option value="">全部</option>
          <option value="INFO">信息</option>
          <option value="WARNING">警告</option>
          <option value="ERROR">错误</option>
          <option value="DEBUG">调试</option>
        </select>
      </div>

      <div class="filter-group">
        <label>搜索:</label>
        <input v-model="searchQuery" @input="filterLogs" type="text" placeholder="搜索日志内容..." />
      </div>

      <div class="action-group">
        <button @click="refreshLogs" class="refresh-btn" :disabled="loading">
          {{ loading ? '刷新中...' : '🔄 刷新' }}
        </button>
        <button @click="clearLogs" class="clear-btn">🗑️ 清空日志</button>
        <button @click="downloadLogs" class="download-btn">📥 下载日志</button>
      </div>
    </div>

    <div class="log-container">
      <div class="log-header">
        <span class="log-count">共 {{ filteredLogs.length }} 条日志</span>
        <label class="auto-scroll-label">
          <input v-model="autoScroll" type="checkbox" />
          自动滚动
        </label>
      </div>

      <div ref="logList" class="log-list">
        <div
          v-for="log in filteredLogs"
          :key="log.id"
          class="log-item"
          :class="log.level.toLowerCase()"
        >
          <span class="log-time">{{ log.timestamp }}</span>
          <span class="log-level">{{ log.level }}</span>
          <span class="log-message">{{ log.message }}</span>
        </div>

        <div v-if="filteredLogs.length === 0" class="no-logs">
          暂无日志数据
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, nextTick, watch } from 'vue'

export default {
  name: 'Logs',
  setup() {
    const loading = ref(false)
    const selectedLevel = ref('')
    const searchQuery = ref('')
    const autoScroll = ref(true)
    const logList = ref(null)

    const logs = ref([
      { id: 1, timestamp: '2024-01-01 10:00:00', level: 'INFO', message: '系统启动成功' },
      { id: 2, timestamp: '2024-01-01 10:01:00', level: 'INFO', message: '数据库连接成功' },
      { id: 3, timestamp: '2024-01-01 10:02:00', level: 'WARNING', message: 'Worker连接超时，正在重试...' },
      { id: 4, timestamp: '2024-01-01 10:03:00', level: 'ERROR', message: 'API调用失败: 网络超时' },
      { id: 5, timestamp: '2024-01-01 10:04:00', level: 'INFO', message: 'Telegram机器人启动成功' }
    ])

    const filteredLogs = computed(() => {
      let result = logs.value

      if (selectedLevel.value) {
        result = result.filter(log => log.level === selectedLevel.value)
      }

      if (searchQuery.value) {
        const query = searchQuery.value.toLowerCase()
        result = result.filter(log =>
          log.message.toLowerCase().includes(query) ||
          log.level.toLowerCase().includes(query)
        )
      }

      return result.reverse()
    })

    const filterLogs = () => {
      nextTick(() => {
        if (autoScroll.value) {
          scrollToBottom()
        }
      })
    }

    const scrollToBottom = () => {
      if (logList.value) {
        logList.value.scrollTop = logList.value.scrollHeight
      }
    }

    const refreshLogs = async () => {
      loading.value = true
      try {
        await new Promise(resolve => setTimeout(resolve, 1000))
      } catch (error) {
        console.error('刷新日志失败:', error)
      } finally {
        loading.value = false
      }
    }

    const clearLogs = () => {
      if (confirm('确定要清空所有日志吗？此操作不可恢复。')) {
        logs.value = []
      }
    }

    const downloadLogs = () => {
      const logText = filteredLogs.value
        .map(log => `${log.timestamp} [${log.level}] ${log.message}`)
        .join('\n')

      const blob = new Blob([logText], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `logs_${new Date().toISOString().split('T')[0]}.txt`
      a.click()
      URL.revokeObjectURL(url)
    }

    watch(filteredLogs, () => {
      if (autoScroll.value) {
        nextTick(() => {
          scrollToBottom()
        })
      }
    })

    onMounted(() => {
      refreshLogs()
    })

    return {
      loading,
      selectedLevel,
      searchQuery,
      autoScroll,
      logList,
      filteredLogs,
      filterLogs,
      refreshLogs,
      clearLogs,
      downloadLogs
    }
  }
}
</script>

<style scoped>
.logs-page {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
  height: calc(100vh - 40px);
  display: flex;
  flex-direction: column;
}

.page-header {
  margin-bottom: 20px;
}

.page-header h1 {
  color: #333;
  margin-bottom: 8px;
}

.page-header p {
  color: #666;
}

.log-controls {
  display: flex;
  gap: 20px;
  align-items: center;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-group label {
  color: #333;
  font-weight: 500;
  white-space: nowrap;
}

.filter-group select,
.filter-group input {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

.action-group {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.refresh-btn, .clear-btn, .download-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.3s;
}

.refresh-btn {
  background: #409eff;
  color: white;
}

.clear-btn {
  background: #f56c6c;
  color: white;
}

.download-btn {
  background: #67c23a;
  color: white;
}

.log-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  overflow: hidden;
}

.log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #f8f9fa;
  border-bottom: 1px solid #eee;
}

.log-list {
  flex: 1;
  overflow-y: auto;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.4;
}

.log-item {
  display: flex;
  padding: 8px 16px;
  border-bottom: 1px solid #f0f0f0;
}

.log-item.info {
  border-left: 3px solid #409eff;
}

.log-item.warning {
  border-left: 3px solid #e6a23c;
}

.log-item.error {
  border-left: 3px solid #f56c6c;
}

.log-time {
  color: #666;
  width: 160px;
  flex-shrink: 0;
}

.log-level {
  width: 80px;
  flex-shrink: 0;
  font-weight: 600;
  color: #409eff;
}

.log-item.warning .log-level {
  color: #e6a23c;
}

.log-item.error .log-level {
  color: #f56c6c;
}

.log-message {
  flex: 1;
  color: #333;
  word-break: break-all;
}

.no-logs {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: #999;
  font-size: 16px;
}
</style>
