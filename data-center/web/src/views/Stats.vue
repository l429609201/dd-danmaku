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

    onMounted(() => {
      refreshStats()
    })

    return {
      stats,
      loading,
      lastUpdate,
      refreshStats
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
</style>
