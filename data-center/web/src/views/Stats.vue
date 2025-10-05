<template>
  <div class="stats-page">
    <div class="page-header">
      <h1>📊 统计数据</h1>
      <p>查看系统运行统计和性能指标</p>
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
        // TODO: 实现真实的API调用
        // const response = await authFetch('/api/v1/stats/summary')
        // if (response.ok) {
        //   const data = await response.json()
        //   stats.value = data
        // }

        // 暂时只更新时间戳，等待后端API实现
        lastUpdate.value = new Date().toLocaleString()
        console.log('统计数据API尚未实现，显示默认值')
      } catch (error) {
        console.error('刷新统计数据失败:', error)
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
  max-width: 1400px;
  margin: 0 auto;
  background: #0f0f0f;
  min-height: 100vh;
}

.page-header {
  margin-bottom: 32px;
  padding: 32px;
  background: #1a1a1a;
  border-radius: 16px;
  border: 1px solid #2a2a2a;
  text-align: center;
}

.page-header h1 {
  color: #ffffff;
  margin-bottom: 12px;
  font-size: 32px;
  font-weight: 700;
}

.page-header p {
  color: #a0a0a0;
  font-size: 18px;
  margin: 0;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 24px;
  margin-bottom: 32px;
}

.stat-card {
  background: #1a1a1a;
  padding: 28px;
  border-radius: 16px;
  border: 1px solid #2a2a2a;
  transition: all 0.3s ease;
  cursor: pointer;
}

.stat-card:hover {
  background: #222222;
  border-color: #3a3a3a;
  transform: translateY(-4px);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
}

.stat-card h3 {
  color: #ffffff;
  margin-bottom: 24px;
  font-size: 20px;
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
  color: #a0a0a0;
  font-size: 15px;
  font-weight: 500;
}

.stat-value {
  color: #ffffff;
  font-weight: 700;
  font-size: 18px;
}

.refresh-section {
  display: flex;
  align-items: center;
  gap: 16px;
  justify-content: center;
}

.refresh-btn {
  padding: 12px 24px;
  background: #409eff;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.3s;
}

.refresh-btn:hover:not(:disabled) {
  background: #337ecc;
}

.refresh-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.last-update {
  color: #999;
  font-size: 12px;
}
</style>
