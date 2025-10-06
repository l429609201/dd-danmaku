<template>
  <div class="logs-page">
    <div class="page-header">
      <h1>日志管理</h1>
      <p>查看和搜索系统日志</p>
    </div>

    <div class="logs-container">
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
  </div>
</template>

<script>
import { authFetch } from '../utils/api.js'

export default {
  name: 'Logs',
  data() {
    return {
      isLoadingFiles: false,
      isLoadingContent: false,
      isSearching: false,
      logFiles: [],
      selectedFile: '',
      logContent: '',
      searchQuery: '',
      searchResults: [],
      isSearchMode: false,
      searchMode: 'context'
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
</style>
