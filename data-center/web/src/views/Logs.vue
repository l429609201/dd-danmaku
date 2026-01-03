<template>
  <div class="logs-page">
    <div class="page-header">
      <h1>日志管理</h1>
      <p>查看系统日志和Worker同步日志</p>
    </div>

    <div class="logs-container">
      <!-- Tab 切换 -->
      <div class="tabs">
        <button
          :class="['tab-btn', { active: activeTab === 'system' }]"
          @click="switchTab('system')"
        >
          📋 系统日志
        </button>
        <button
          :class="['tab-btn', { active: activeTab === 'worker' }]"
          @click="switchTab('worker')"
        >
          🔄 Worker日志
        </button>
      </div>

      <!-- 系统日志 Tab -->
      <div v-if="activeTab === 'system'" class="tab-content">
        <!-- 搜索栏 -->
        <div class="search-section">
          <div class="search-controls">
            <input
              v-model="searchQuery"
              type="text"
              placeholder="在所有日志文件中搜索..."
              class="search-input"
              @keyup.enter="executeSearch"
              :disabled="isLoading"
            />
            <button
              @click="executeSearch"
              :disabled="isSearching || !searchQuery.trim()"
              class="search-btn"
            >
              {{ isSearching ? '搜索中...' : '搜索' }}
            </button>
          </div>

          <!-- 搜索模式切换 -->
          <div class="search-mode">
            <label>
              <input
                type="radio"
                v-model="searchMode"
                value="filter"
                :disabled="isLoading"
              />
              筛选模式 (仅显示匹配行)
            </label>
            <label>
              <input
                type="radio"
                v-model="searchMode"
                value="context"
                :disabled="isLoading"
              />
              定位模式 (显示完整处理过程)
            </label>
          </div>
        </div>

        <div class="divider"></div>

        <!-- 加载状态 -->
        <div v-if="isLoading" class="loading">
          <div class="loading-spinner"></div>
          <p>{{ loadingText }}</p>
        </div>

        <!-- 结果展示区 -->
        <div v-else>
          <!-- 搜索结果视图 -->
          <div v-if="isSearchMode">
            <button @click="clearSearch" class="back-btn">
              ← 返回文件浏览
            </button>

            <div v-if="hasSearchResults" class="log-viewer-container">
              <div
                v-for="(line, index) in parsedLogResults"
                :key="index"
                class="log-line"
                :class="line.type === 'log' ? line.level.toLowerCase() : 'raw'"
              >
                <template v-if="line.type === 'log'">
                  <span class="timestamp">{{ line.timestamp }}</span>
                  <span class="level">{{ line.level }}</span>
                  <span class="message">{{ line.message }}</span>
                </template>
                <template v-else>
                  {{ line.content }}
                </template>
              </div>
            </div>
            <div v-else class="empty-state">
              <p>未找到匹配的日志记录。</p>
            </div>
          </div>

          <!-- 文件浏览视图 (默认) -->
          <div v-else>
            <div class="file-selector">
              <select
                v-model="selectedFile"
                @change="fetchLogContent"
                :disabled="isLoadingFiles"
                class="file-select"
              >
                <option value="">请选择一个日志文件</option>
                <option
                  v-for="file in logFiles"
                  :key="file"
                  :value="file"
                >
                  {{ file }}
                </option>
              </select>
            </div>

            <div v-if="logContent" class="log-viewer-container">
              <div
                v-for="(line, index) in parsedLogContent"
                :key="index"
                class="log-line"
                :class="line.type === 'log' ? line.level.toLowerCase() : 'raw'"
              >
                <template v-if="line.type === 'log'">
                  <span class="timestamp">{{ line.timestamp }}</span>
                  <span class="level">{{ line.level }}</span>
                  <span class="message">{{ line.message }}</span>
                </template>
                <template v-else>
                  {{ line.content }}
                </template>
              </div>
            </div>
            <div v-else class="empty-state">
              <p>请选择一个日志文件查看内容</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Worker日志 Tab -->
      <div v-if="activeTab === 'worker'" class="tab-content">
        <!-- Worker 筛选和刷新 -->
        <div class="worker-controls">
          <div class="control-row">
            <select v-model="selectedWorkerId" class="worker-select" @change="fetchWorkerLogs">
              <option value="">全部 Worker</option>
              <option v-for="worker in workerList" :key="worker" :value="worker">
                {{ worker }}
              </option>
            </select>
            <select v-model="workerLogLevel" class="level-select" @change="filterWorkerLogs">
              <option value="">全部级别</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
              <option value="DEBUG">DEBUG</option>
            </select>
            <input
              v-model="workerLogSearch"
              type="text"
              placeholder="搜索日志内容..."
              class="search-input worker-search"
              @input="filterWorkerLogs"
            />
            <button @click="fetchWorkerLogs" class="refresh-btn" :disabled="isLoadingWorkerLogs">
              {{ isLoadingWorkerLogs ? '加载中...' : '🔄 刷新' }}
            </button>
          </div>
          <div class="log-count">
            共 {{ filteredWorkerLogs.length }} 条日志
            <span v-if="workerLogLevel || workerLogSearch"> (已筛选)</span>
          </div>
        </div>

        <div class="divider"></div>

        <!-- Worker 日志列表 -->
        <div v-if="isLoadingWorkerLogs" class="loading">
          <div class="loading-spinner"></div>
          <p>正在加载 Worker 日志...</p>
        </div>
        <div v-else-if="filteredWorkerLogs.length > 0" class="log-viewer-container worker-log-viewer">
          <div
            v-for="log in filteredWorkerLogs"
            :key="log.id"
            class="worker-log-item"
            :class="log.level.toLowerCase()"
          >
            <div class="log-header">
              <span class="log-time">{{ formatTime(log.timestamp) }}</span>
              <span class="log-level" :class="log.level.toLowerCase()">{{ log.level }}</span>
              <span class="log-worker">{{ log.worker_id }}</span>
            </div>
            <div class="log-message">{{ log.message }}</div>
            <div v-if="log.data && Object.keys(log.data).length > 0" class="log-data">
              <details>
                <summary>详细数据</summary>
                <pre>{{ JSON.stringify(log.data, null, 2) }}</pre>
              </details>
            </div>
          </div>
        </div>
        <div v-else class="empty-state">
          <p>暂无 Worker 日志数据</p>
          <p class="hint">Worker 会定期同步日志到数据中心</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { authFetch } from '../utils/api.js'

export default {
  name: 'Logs',
  data() {
    return {
      // Tab 状态
      activeTab: 'system',
      // 系统日志相关
      isLoadingFiles: false,
      isLoadingContent: false,
      isSearching: false,
      logFiles: [],
      selectedFile: '',
      logContent: '',
      searchQuery: '',
      searchResults: [],
      isSearchMode: false,
      searchMode: 'context',
      // Worker 日志相关
      isLoadingWorkerLogs: false,
      workerLogs: [],
      filteredWorkerLogs: [],
      workerList: [],
      selectedWorkerId: '',
      workerLogLevel: '',
      workerLogSearch: ''
    }
  },
  computed: {
    isLoading() {
      return this.isLoadingFiles || this.isLoadingContent || this.isSearching
    },
    hasSearchResults() {
      return this.searchResults.length > 0
    },
    loadingText() {
      if (this.isLoadingFiles) return '正在获取文件列表...'
      if (this.isLoadingContent) return '正在加载日志内容...'
      if (this.isSearching) return `正在以 [${this.searchMode === 'context' ? '定位' : '筛选'}] 模式搜索...`
      return ''
    },
    // 日志行解析
    parsedLogContent() {
      if (!this.logContent) return []
      return this.logContent.split('\n').map(this.parseLogLine)
    },
    parsedLogResults() {
      if (!this.hasSearchResults) return []

      const finalLines = []

      if (this.searchMode === 'context') {
        // 定位模式
        finalLines.push(`以"定位"模式找到 ${this.searchResults.length} 个完整处理过程:`)
        
        this.searchResults.forEach((block, index) => {
          finalLines.push('')
          const datePart = block.date && block.date.includes(' ') ? block.date.split(' ')[0] : block.date
          finalLines.push(`--- [ 记录在 ${block.file} 于 ${datePart} ] ---`)
          
          block.lines.forEach(line => finalLines.push(line))
          
          if (index < this.searchResults.length - 1) {
            finalLines.push('')
            finalLines.push('========================================================')
          }
        })
      } else {
        // 筛选模式
        finalLines.push(`以"筛选"模式找到 ${this.searchResults.length} 条结果:`)

        let lastFile = ''
        let lastDatePart = ''

        this.searchResults.forEach(result => {
          const currentDatePart = result.date ? result.date.split(' ')[0] : ''
          
          if (result.file !== lastFile || currentDatePart !== lastDatePart) {
            if (finalLines.length > 1) {
              finalLines.push('')
            }
            finalLines.push(`--- [ 记录在 ${result.file} 于 ${currentDatePart || '未知'} ] ---`)
            lastFile = result.file
            lastDatePart = currentDatePart
          }
          
          finalLines.push(result.content)
        })
      }
      
      return finalLines.map(this.parseLogLine)
    }
  },
  methods: {
    parseLogLine(line) {
      const match = line.match(/^(\d{4}-\d{2}-\d{2}\s(\d{2}:\d{2}:\d{2})),\d+\s-\s.+?\s-\s(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s-\s(.*)$/)
      if (match) {
        return {
          type: 'log',
          timestamp: match[2],
          level: match[3],
          message: match[4].trim(),
        }
      }
      return { type: 'raw', content: line }
    },
    async fetchLogFiles() {
      this.isLoadingFiles = true
      try {
        const response = await authFetch('/api/logs/list')
        if (response.ok) {
          this.logFiles = await response.json()
          if (!this.isSearchMode && this.logFiles.length > 0) {
            if (!this.selectedFile) {
              this.selectedFile = this.logFiles[0]
              await this.fetchLogContent()
            }
          }
        } else {
          throw new Error('获取日志文件列表失败')
        }
      } catch (error) {
        console.error('获取日志文件列表失败:', error)
        alert('获取日志文件列表失败！')
      } finally {
        this.isLoadingFiles = false
      }
    },
    async fetchLogContent() {
      if (!this.selectedFile) return
      
      this.isLoadingContent = true
      this.logContent = `正在加载 ${this.selectedFile}...`
      
      try {
        const response = await authFetch(`/api/logs/view?filename=${encodeURIComponent(this.selectedFile)}`)
        if (response.ok) {
          this.logContent = await response.text() || '（文件为空）'
        } else {
          throw new Error(`加载日志失败: ${response.status}`)
        }
      } catch (error) {
        console.error(`加载日志 ${this.selectedFile} 失败:`, error)
        this.logContent = `加载文件失败: ${error.message}`
        alert(`加载日志 ${this.selectedFile} 失败！`)
      } finally {
        this.isLoadingContent = false
      }
    },
    async executeSearch() {
      if (!this.searchQuery.trim()) {
        alert('请输入搜索关键词。')
        return
      }
      
      this.isSearching = true
      this.isSearchMode = true
      this.searchResults = []
      
      const endpoint = this.searchMode === 'context' ? '/api/logs/search_context' : '/api/logs/search'
      
      try {
        const response = await authFetch(`${endpoint}?q=${encodeURIComponent(this.searchQuery)}`)
        if (response.ok) {
          this.searchResults = await response.json()
        } else {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.detail || '搜索失败')
        }
      } catch (error) {
        console.error('搜索失败:', error)
        alert(error.message || '搜索失败！')
      } finally {
        this.isSearching = false
      }
    },
    clearSearch() {
      this.isSearchMode = false
      this.searchQuery = ''
      this.searchResults = []
      if (this.selectedFile && !this.logContent) {
        this.fetchLogContent()
      }
    },
    // Tab 切换
    switchTab(tab) {
      this.activeTab = tab
      if (tab === 'worker' && this.workerLogs.length === 0) {
        this.fetchWorkerLogs()
      }
    },
    // Worker 日志相关方法
    async fetchWorkerLogs() {
      this.isLoadingWorkerLogs = true
      try {
        const url = this.selectedWorkerId
          ? `/worker-api/sync/logs?worker_id=${encodeURIComponent(this.selectedWorkerId)}&limit=500`
          : '/worker-api/sync/logs?limit=500'
        const response = await authFetch(url)
        if (response.ok) {
          const data = await response.json()
          this.workerLogs = data.logs || []
          // 提取 Worker 列表
          const workers = new Set(this.workerLogs.map(log => log.worker_id))
          this.workerList = Array.from(workers).filter(Boolean)
          this.filterWorkerLogs()
        } else {
          throw new Error('获取 Worker 日志失败')
        }
      } catch (error) {
        console.error('获取 Worker 日志失败:', error)
        this.workerLogs = []
        this.filteredWorkerLogs = []
      } finally {
        this.isLoadingWorkerLogs = false
      }
    },
    filterWorkerLogs() {
      let logs = [...this.workerLogs]

      // 按级别筛选
      if (this.workerLogLevel) {
        logs = logs.filter(log => log.level.toUpperCase() === this.workerLogLevel)
      }

      // 按关键词搜索
      if (this.workerLogSearch.trim()) {
        const keyword = this.workerLogSearch.toLowerCase()
        logs = logs.filter(log =>
          log.message.toLowerCase().includes(keyword) ||
          JSON.stringify(log.data || {}).toLowerCase().includes(keyword)
        )
      }

      this.filteredWorkerLogs = logs
    },
    formatTime(timestamp) {
      if (!timestamp) return '-'
      const date = new Date(timestamp)
      return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    }
  },
  async mounted() {
    await this.fetchLogFiles()
  }
}
</script>

<style scoped>
.logs-page {
  padding: 24px;
  background: #f5f5f5;
  min-height: 100vh;
}

.page-header {
  margin-bottom: 24px;
}

.page-header h1 {
  color: #333;
  margin: 0 0 8px 0;
  font-size: 28px;
  font-weight: 600;
}

.page-header p {
  color: #666;
  margin: 0;
  font-size: 16px;
}

.logs-container {
  background: white;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.search-section {
  margin-bottom: 20px;
}

.search-controls {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.search-input {
  flex: 1;
  padding: 12px 16px;
  border: 2px solid #e0e0e0;
  border-radius: 6px;
  font-size: 14px;
  transition: border-color 0.3s ease;
}

.search-input:focus {
  outline: none;
  border-color: #1976d2;
}

.search-input:disabled {
  background: #f5f5f5;
  cursor: not-allowed;
}

.search-btn {
  padding: 12px 24px;
  background: #1976d2;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
}

.search-btn:hover:not(:disabled) {
  background: #1565c0;
  transform: translateY(-1px);
}

.search-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
  transform: none;
}

.search-mode {
  display: flex;
  gap: 20px;
}

.search-mode label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #666;
  font-size: 14px;
  cursor: pointer;
}

.search-mode input[type="radio"] {
  margin: 0;
}

.divider {
  height: 1px;
  background: #e0e0e0;
  margin: 20px 0;
}

.loading {
  text-align: center;
  padding: 40px;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #1976d2;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.back-btn {
  padding: 8px 16px;
  background: #f5f5f5;
  color: #333;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  margin-bottom: 16px;
  transition: all 0.3s ease;
}

.back-btn:hover {
  background: #e0e0e0;
}

.file-selector {
  margin-bottom: 16px;
}

.file-select {
  width: 100%;
  max-width: 400px;
  padding: 12px 16px;
  border: 2px solid #e0e0e0;
  border-radius: 6px;
  font-size: 14px;
  background: white;
  cursor: pointer;
}

.file-select:focus {
  outline: none;
  border-color: #1976d2;
}

.log-viewer-container {
  background-color: #282c34;
  font-family: 'Courier New', Courier, monospace;
  font-size: 13px;
  padding: 16px;
  border-radius: 6px;
  max-height: 600px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.log-line {
  line-height: 1.6;
  padding: 1px 0;
  color: #abb2bf;
}

.log-line.info { color: #98c379; }
.log-line.warning { color: #e5c07b; }
.log-line.error,
.log-line.critical { color: #e06c75; }
.log-line.debug { color: #56b6c2; }
.log-line.raw {
  color: #95a5a6;
  font-style: italic;
}

.timestamp {
  color: #61afef;
  margin-right: 1em;
}

.level {
  font-weight: bold;
  margin-right: 1em;
  text-transform: uppercase;
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: #666;
}

.empty-state p {
  margin: 0;
  font-size: 16px;
}

.empty-state .hint {
  margin-top: 8px;
  font-size: 14px;
  color: #999;
}

/* Tab 样式 */
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  border-bottom: 2px solid #e0e0e0;
  padding-bottom: 12px;
}

.tab-btn {
  padding: 10px 20px;
  background: #f5f5f5;
  color: #666;
  border: 1px solid #e0e0e0;
  border-radius: 6px 6px 0 0;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
}

.tab-btn:hover {
  background: #e8e8e8;
}

.tab-btn.active {
  background: #1976d2;
  color: white;
  border-color: #1976d2;
}

.tab-content {
  min-height: 400px;
}

/* Worker 日志样式 */
.worker-controls {
  margin-bottom: 16px;
}

.control-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
}

.worker-select,
.level-select {
  padding: 10px 14px;
  border: 2px solid #e0e0e0;
  border-radius: 6px;
  font-size: 14px;
  background: white;
  cursor: pointer;
  min-width: 140px;
}

.worker-select:focus,
.level-select:focus {
  outline: none;
  border-color: #1976d2;
}

.worker-search {
  flex: 1;
  min-width: 200px;
}

.refresh-btn {
  padding: 10px 20px;
  background: #4caf50;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
}

.refresh-btn:hover:not(:disabled) {
  background: #43a047;
}

.refresh-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.log-count {
  margin-top: 12px;
  font-size: 14px;
  color: #666;
}

.worker-log-viewer {
  background: #1e1e1e;
}

.worker-log-item {
  padding: 12px;
  border-bottom: 1px solid #333;
  transition: background 0.2s ease;
}

.worker-log-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.worker-log-item:last-child {
  border-bottom: none;
}

.worker-log-item.info { border-left: 3px solid #98c379; }
.worker-log-item.warn { border-left: 3px solid #e5c07b; }
.worker-log-item.error { border-left: 3px solid #e06c75; }
.worker-log-item.debug { border-left: 3px solid #56b6c2; }

.log-header {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 6px;
}

.log-time {
  color: #61afef;
  font-size: 12px;
  font-family: 'Courier New', monospace;
}

.log-level {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: bold;
  text-transform: uppercase;
}

.log-level.info { background: rgba(152, 195, 121, 0.2); color: #98c379; }
.log-level.warn { background: rgba(229, 192, 123, 0.2); color: #e5c07b; }
.log-level.error { background: rgba(224, 108, 117, 0.2); color: #e06c75; }
.log-level.debug { background: rgba(86, 182, 194, 0.2); color: #56b6c2; }

.log-worker {
  color: #c678dd;
  font-size: 12px;
}

.log-message {
  color: #abb2bf;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
}

.log-data {
  margin-top: 8px;
}

.log-data summary {
  color: #61afef;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}

.log-data summary:hover {
  color: #7ec8f3;
}

.log-data pre {
  margin: 8px 0 0 0;
  padding: 10px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  font-size: 12px;
  color: #98c379;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
