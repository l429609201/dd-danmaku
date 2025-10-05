<template>
  <div class="dashboard">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-content">
        <h1>🎯 DanDanPlay API 数据交互中心</h1>
        <p>系统运行状态总览</p>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon">📊</div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.totalRequests }}</div>
          <div class="stat-label">总请求数</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🤖</div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.activeWorkers }}</div>
          <div class="stat-label">活跃Worker</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🚫</div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.blockedIPs }}</div>
          <div class="stat-label">封禁IP</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">⚠️</div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.errorRate }}%</div>
          <div class="stat-label">错误率</div>
        </div>
      </div>
    </div>

    <!-- 图表区域 -->
    <div class="charts-grid">
      <div class="chart-card">
        <div class="card-header">
          <h3>📈 请求趋势</h3>
        </div>
        <div class="card-body">
          <div class="chart-placeholder">图表加载中...</div>
        </div>
      </div>
      <div class="chart-card">
        <div class="card-header">
          <h3>🔄 Worker状态</h3>
        </div>
        <div class="card-body">
          <div class="chart-placeholder">图表加载中...</div>
        </div>
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
        // TODO: 实现真实的API调用
        // const response = await authFetch('/api/v1/stats/dashboard')
        // if (response.ok) {
        //   const data = await response.json()
        //   stats.value = data
        // }

        // 暂时保持初始值为0，等待后端API实现
        console.log('统计数据API尚未实现，显示默认值')
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
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
  background: #0f0f0f;
  min-height: 100vh;
}

/* 页面头部 */
.page-header {
  margin-bottom: 32px;
  padding: 32px;
  background: #1a1a1a;
  border-radius: 16px;
  border: 1px solid #2a2a2a;
  text-align: center;
}

.header-content h1 {
  font-size: 36px;
  font-weight: 700;
  color: #ffffff;
  margin: 0 0 12px 0;
}

.header-content p {
  color: #a0a0a0;
  margin: 0;
  font-size: 18px;
}

/* 统计卡片网格 */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
  margin-bottom: 32px;
}

.stat-card {
  background: #1a1a1a;
  padding: 28px;
  border-radius: 16px;
  border: 1px solid #2a2a2a;
  display: flex;
  align-items: center;
  gap: 20px;
  transition: all 0.3s ease;
  cursor: pointer;
}

.stat-card:hover {
  background: #222222;
  border-color: #3a3a3a;
  transform: translateY(-4px);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
}

.stat-icon {
  font-size: 28px;
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-radius: 16px;
  color: white;
  flex-shrink: 0;
}

.stat-content {
  flex: 1;
}

.stat-value {
  font-size: 32px;
  font-weight: 700;
  color: #ffffff;
  margin-bottom: 6px;
}

.stat-label {
  color: #a0a0a0;
  font-size: 15px;
  font-weight: 500;
}

/* 图表网格 */
.charts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(450px, 1fr));
  gap: 20px;
}

.chart-card {
  background: #1a1a1a;
  border-radius: 16px;
  border: 1px solid #2a2a2a;
  overflow: hidden;
  transition: all 0.3s ease;
}

.chart-card:hover {
  background: #222222;
  border-color: #3a3a3a;
  transform: translateY(-2px);
}

.card-header {
  padding: 24px 28px;
  border-bottom: 1px solid #2a2a2a;
}

.card-header h3 {
  font-size: 20px;
  font-weight: 600;
  color: #ffffff;
  margin: 0;
}

.card-body {
  padding: 28px;
}

.chart-placeholder {
  height: 280px;
  background: #0f0f0f;
  border: 2px dashed #3a3a3a;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #a0a0a0;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 500;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .dashboard {
    padding: 16px;
  }

  .stats-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .charts-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .stat-card {
    padding: 24px;
  }

  .page-header {
    padding: 24px;
  }

  .header-content h1 {
    font-size: 28px;
  }

  .header-content p {
    font-size: 16px;
  }
}
</style>
