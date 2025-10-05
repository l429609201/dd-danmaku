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
import { authFetch } from '../utils/api.js'

export default {
  name: 'Logs',
  setup() {
    const loading = ref(false)
    const selectedLevel = ref('')
    const searchQuery = ref('')
    const autoScroll = ref(true)
    const logList = ref(null)

    const logs = ref([])

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
        const response = await authFetch('/api/v1/logs/system?limit=100')
        if (response.ok) {
          const data = await response.json()
          logs.value = data.map((log, index) => ({
            id: index + 1,
            timestamp: log.timestamp || log.created_at,
            level: log.level,
            message: log.message
          }))
        } else {
          console.error('获取日志失败:', response.status)
        }
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
      nextTick(() => {
        if (autoScroll.value) {
          scrollToBottom()
        }
      })
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
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
  height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  background: #f5f5f5;
}

.page-header {
  margin-bottom: 20px;
  padding: 24px;
  background: white;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.page-header h1 {
  color: #333;
  margin-bottom: 8px;
  font-size: 28px;
  font-weight: 600;
}

.page-header p {
  color: #666;
  font-size: 16px;
  margin: 0;
}

.log-controls {
  display: flex;
  gap: 24px;
  align-items: center;
  margin-bottom: 24px;
  flex-wrap: wrap;
  padding: 24px;
  background: #1a1a1a;
  border-radius: 16px;
  border: 1px solid #2a2a2a;
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.filter-group label {
  color: #ffffff;
  font-weight: 500;
  white-space: nowrap;
  font-size: 15px;
}

.filter-group select,
.filter-group input {
  padding: 10px 16px;
  border: 1px solid #3a3a3a;
  border-radius: 8px;
  font-size: 14px;
  background: #0f0f0f;
  color: #ffffff;
  transition: all 0.2s;
}

.filter-group select:focus,
.filter-group input:focus {
  outline: none;
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.action-group {
  display: flex;
  gap: 12px;
  margin-left: auto;
}

.refresh-btn, .clear-btn, .download-btn {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.3s ease;
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
