<template>
  <div class="dashboard">
    <h1>🎯 DanDanPlay API 数据交互中心</h1>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">{{ stats.totalRequests }}</div>
        <div class="stat-label">总请求数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ stats.activeWorkers }}</div>
        <div class="stat-label">活跃Worker</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ stats.blockedIPs }}</div>
        <div class="stat-label">封禁IP</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ stats.errorRate }}%</div>
        <div class="stat-label">错误率</div>
      </div>
    </div>

    <div class="charts-grid">
      <div class="chart-card">
        <h3>请求趋势</h3>
        <div class="chart-placeholder">图表加载中...</div>
      </div>
      <div class="chart-card">
        <h3>Worker状态</h3>
        <div class="chart-placeholder">图表加载中...</div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'

export default {
  name: 'Dashboard',
  setup() {
    const stats = ref({
      totalRequests: 0,
      activeWorkers: 0,
      blockedIPs: 0,
      errorRate: 0
    })

    const loadStats = async () => {
      try {
        // 模拟API调用
        stats.value = {
          totalRequests: 12345,
          activeWorkers: 4,
          blockedIPs: 23,
          errorRate: 2.1
        }
      } catch (error) {
        console.error('加载统计数据失败:', error)
      }
    }

    onMounted(() => {
      loadStats()
    })

    return {
      stats
    }
  }
}
</script>

<style scoped>
.dashboard {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

h1 {
  text-align: center;
  color: #333;
  margin-bottom: 30px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
  margin-bottom: 30px;
}

.stat-card {
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  text-align: center;
}

.stat-value {
  font-size: 32px;
  font-weight: bold;
  color: #409EFF;
  margin-bottom: 8px;
}

.stat-label {
  font-size: 14px;
  color: #666;
}

.charts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 20px;
}

.chart-card {
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.chart-card h3 {
  margin: 0 0 15px 0;
  color: #333;
}

.chart-placeholder {
  height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
  border-radius: 4px;
  color: #999;
}
</style>
