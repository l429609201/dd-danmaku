<template>
  <div class="stats-page">
    <div class="page-header">
      <div class="header-content">
        <h1>📊 统计数据</h1>
        <p>查看系统运行统计和性能指标</p>
      </div>
      <div class="header-actions">
        <button @click="refreshStats" :disabled="loading" class="btn btn-primary">
          {{ loading ? '刷新中...' : '🔄 刷新数据' }}
        </button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <h3>📈 请求统计</h3>
        <div class="stat-list">
          <div class="stat-item">
            <span class="stat-label">今日请求</span>
            <span class="stat-value">{{ stats.todayRequests }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">总请求数</span>
            <span class="stat-value">{{ stats.totalRequests }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">成功率</span>
            <span class="stat-value">{{ stats.successRate }}%</span>
          </div>
        </div>
      </div>

      <div class="stat-card">
        <h3>🌐 Worker状态</h3>
        <div class="stat-list">
          <div class="stat-item">
            <span class="stat-label">在线Worker</span>
            <span class="stat-value">{{ stats.onlineWorkers }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">总Worker数</span>
            <span class="stat-value">{{ stats.totalWorkers }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">平均响应时间</span>
            <span class="stat-value">{{ stats.avgResponseTime }}ms</span>
          </div>
        </div>
      </div>

      <div class="stat-card">
        <h3>🛡️ 安全统计</h3>
        <div class="stat-list">
          <div class="stat-item">
            <span class="stat-label">封禁IP数</span>
            <span class="stat-value">{{ stats.blockedIPs }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">今日拦截</span>
            <span class="stat-value">{{ stats.todayBlocked }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">违规请求</span>
            <span class="stat-value">{{ stats.violationRequests }}</span>
          </div>
        </div>
      </div>

      <div class="stat-card">
        <h3>💾 系统资源</h3>
        <div class="stat-list">
          <div class="stat-item">
            <span class="stat-label">内存使用</span>
            <span class="stat-value">{{ stats.memoryUsage }}MB</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">CPU使用率</span>
            <span class="stat-value">{{ stats.cpuUsage }}%</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">运行时间</span>
            <span class="stat-value">{{ stats.uptime }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 系统日志预览 -->
    <div class="logs-section">
      <div class="section-header">
        <h2>📋 系统日志</h2>
        <div class="log-controls">
          <button @click="showLogsModal = true" class="btn btn-primary">
            📊 查看详细日志
          </button>
        </div>
      </div>

      <div class="logs-preview">
        <div v-if="recentLogs.length === 0" class="no-logs">
          暂无最近日志
        </div>
        <div v-else class="log-list">
          <div v-for="log in recentLogs.slice(0, 5)" :key="log.id" class="log-item" :class="`log-${log.level.toLowerCase()}`">
            <div class="log-header">
              <span class="log-time">{{ formatTime(log.created_at) }}</span>
              <span class="log-level">{{ log.level }}</span>
              <span class="log-source">{{ log.source || log.worker_id }}</span>
            </div>
            <div class="log-message">{{ log.message }}</div>
          </div>
          <div v-if="recentLogs.length > 5" class="more-logs">
            还有 {{ recentLogs.length - 5 }} 条日志，点击上方按钮查看全部
          </div>
        </div>
      </div>
    </div>

    <!-- 详细日志弹窗 -->
    <div v-if="showLogsModal" class="modal-overlay" @click="showLogsModal = false">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h2>📋 详细日志与参数</h2>
          <button @click="showLogsModal = false" class="close-btn">✕</button>
        </div>

        <div class="modal-body">
          <!-- 日志控制 -->
          <div class="log-controls">
            <select v-model="selectedLogType" @change="loadLogs" class="log-type-select">
              <option value="all">所有日志</option>
              <option value="worker">Worker日志</option>
              <option value="system">系统日志</option>
            </select>
            <button @click="loadLogs" :disabled="loading" class="btn btn-secondary">
              {{ loading ? '加载中...' : '🔄 刷新日志' }}
            </button>
          </div>

          <!-- 日志列表 -->
          <div class="logs-container">
            <div v-if="logs.length === 0" class="no-logs">
              暂无日志数据
            </div>
            <div v-else class="log-list">
              <div v-for="log in logs" :key="log.id" class="log-item" :class="`log-${log.level.toLowerCase()}`">
                <div class="log-header">
                  <span class="log-time">{{ formatTime(log.created_at) }}</span>
                  <span class="log-level">{{ log.level }}</span>
                  <span class="log-source">{{ log.source || log.worker_id }}</span>
                </div>
                <div class="log-message">{{ log.message }}</div>
                <div v-if="log.details && Object.keys(log.details).length > 0" class="log-details">
                  <pre>{{ JSON.stringify(log.details, null, 2) }}</pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="refresh-section">
      <button @click="refreshStats" class="refresh-btn" :disabled="loading">
        {{ loading ? '刷新中...' : '🔄 刷新数据' }}
      </button>
      <span class="last-update">最后更新: {{ lastUpdate }}</span>
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import { authFetch } from '@/utils/api'

export default {
  name: 'Stats',
  setup() {
    const loading = ref(false)
    const lastUpdate = ref('')

    const stats = ref({
      todayRequests: 0,
      totalRequests: 0,
      successRate: 0,
      onlineWorkers: 0,
      totalWorkers: 0,
      avgResponseTime: 0,
      blockedIPs: 0,
      todayBlocked: 0,
      violationRequests: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      uptime: '0分钟'
    })

    // 日志相关
    const logs = ref([])
    const recentLogs = ref([])
    const selectedLogType = ref('all')
    const showLogsModal = ref(false)

    const refreshStats = async () => {
      loading.value = true
      try {
        // 调用统计数据API
        const response = await authFetch('/api/stats/summary')
        if (response.ok) {
          const data = await response.json()
          stats.value = {
            todayRequests: data.todayRequests || 0,
            totalRequests: data.totalRequests || 0,
            successRate: data.successRate || 0,
            onlineWorkers: data.onlineWorkers || 0,
            totalWorkers: data.totalWorkers || 0,
            avgResponseTime: data.avgResponseTime || 0,
            blockedIPs: data.blockedIPs || 0,
            todayBlocked: data.todayBlocked || 0,
            violationRequests: data.violationRequests || 0,
            memoryUsage: data.memoryUsage || 0,
            cpuUsage: data.cpuUsage || 0,
            uptime: data.uptime || '0分钟'
          }
          lastUpdate.value = new Date().toLocaleString()
        } else {
          throw new Error(`API调用失败: ${response.status}`)
        }
      } catch (error) {
        console.error('刷新统计数据失败:', error)
        // 如果API调用失败，保持当前数据不变
        lastUpdate.value = new Date().toLocaleString()
      } finally {
        loading.value = false
      }
    }

    // 加载日志
    const loadLogs = async () => {
      try {
        let url = '/api/logs'
        if (selectedLogType.value === 'worker') {
          url = '/api/logs/worker-logs'
        }

        const response = await authFetch(url)
        if (response.ok) {
          const data = await response.json()
          logs.value = data.logs || []
        }
      } catch (error) {
        console.error('加载日志失败:', error)
        logs.value = []
      }
    }

    // 加载最近日志（用于预览）
    const loadRecentLogs = async () => {
      try {
        const response = await authFetch('/api/logs?limit=10')
        if (response.ok) {
          const data = await response.json()
          recentLogs.value = data.logs || []
        }
      } catch (error) {
        console.error('加载最近日志失败:', error)
        recentLogs.value = []
      }
    }

    // 格式化时间
    const formatTime = (timeStr) => {
      if (!timeStr) return ''
      try {
        return new Date(timeStr).toLocaleString()
      } catch {
        return timeStr
      }
    }

    onMounted(() => {
      refreshStats()
      loadRecentLogs()
      loadLogs()
    })

    return {
      stats,
      loading,
      lastUpdate,
      refreshStats,
      logs,
      recentLogs,
      selectedLogType,
      showLogsModal,
      loadLogs,
      loadRecentLogs,
      formatTime
    }
  }
}
</script>

<style scoped>
.stats-page {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
  background: #f5f5f5;
  min-height: calc(100vh - 64px);
}

.page-header {
  margin-bottom: 24px;
  padding: 24px;
  background: white;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.header-actions .btn {
  white-space: nowrap;
}

.header-content {
  text-align: left;
}

.header-content h1 {
  color: #333;
  margin-bottom: 8px;
  font-size: 28px;
  font-weight: 600;
  margin: 0 0 8px 0;
}

.header-content p {
  color: #666;
  font-size: 16px;
  margin: 0;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 24px;
  margin-bottom: 32px;
}

.stat-card {
  background: white;
  padding: 24px;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  transition: all 0.3s ease;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.stat-card:hover {
  background: #fafafa;
  border-color: #d0d0d0;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}

.stat-card h3 {
  color: #333;
  margin-bottom: 20px;
  font-size: 18px;
  font-weight: 600;
}

.stat-list {
  display: grid;
  gap: 16px;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #2a2a2a;
}

.stat-item:last-child {
  border-bottom: none;
}

.stat-label {
  color: #666;
  font-size: 14px;
  font-weight: 500;
}

.stat-value {
  color: #333;
  font-weight: 600;
  font-size: 16px;
}

.refresh-section {
  display: flex;
  align-items: center;
  gap: 16px;
  justify-content: center;
  padding: 20px;
  background: white;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.refresh-btn {
  padding: 10px 20px;
  background: #1976d2;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.3s;
}

.refresh-btn:hover:not(:disabled) {
  background: #1565c0;
  transform: translateY(-1px);
}

.refresh-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
  transform: none;
}

.last-update {
  color: #666;
  font-size: 14px;
}

/* 日志样式 */
.logs-section {
  margin-top: 24px;
  background: white;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid #e0e0e0;
}

.section-header h2 {
  margin: 0;
  color: #333;
  font-size: 18px;
  font-weight: 600;
}

.logs-preview {
  padding: 16px 24px;
  max-height: 300px;
  overflow-y: auto;
}

.more-logs {
  text-align: center;
  color: #666;
  font-style: italic;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 4px;
  margin-top: 8px;
}

/* 弹窗样式 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  border-radius: 8px;
  width: 90%;
  max-width: 1000px;
  max-height: 80vh;
  overflow: hidden;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid #e0e0e0;
  background: #f8f9fa;
}

.modal-header h2 {
  margin: 0;
  color: #333;
  font-size: 18px;
  font-weight: 600;
}

.close-btn {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #666;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s;
}

.close-btn:hover {
  background: #e9ecef;
  color: #333;
}

.modal-body {
  padding: 24px;
  overflow-y: auto;
  max-height: calc(80vh - 80px);
}

.log-controls {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;
}

.log-type-select {
  padding: 6px 12px;
  border: 1px solid #d0d0d0;
  border-radius: 4px;
  background: white;
  font-size: 14px;
}

.logs-container {
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  background: #f8f9fa;
  padding: 16px;
}

.no-logs {
  text-align: center;
  color: #666;
  padding: 40px;
  font-style: italic;
}

.log-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.log-item {
  background: white;
  border-radius: 6px;
  padding: 12px;
  border-left: 4px solid #dee2e6;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.log-item.log-error {
  border-left-color: #dc3545;
  background: #fff5f5;
}

.log-item.log-warning {
  border-left-color: #ffc107;
  background: #fffbf0;
}

.log-item.log-info {
  border-left-color: #17a2b8;
  background: #f0f9ff;
}

.log-header {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 6px;
  font-size: 12px;
}

.log-time {
  color: #666;
}

.log-level {
  background: #e9ecef;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 600;
  font-size: 11px;
}

.log-source {
  color: #495057;
  font-weight: 500;
}

.log-message {
  color: #333;
  font-size: 14px;
  margin-bottom: 6px;
}

.log-details {
  background: #f1f3f4;
  padding: 8px;
  border-radius: 4px;
  font-size: 11px;
}

.log-details pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
