<template>
  <div class="dashboard">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-content">
        <h1>🎯 DanDanPlay API 数据交互中心</h1>
        <p>系统运行状态总览</p>
      </div>
      <div class="header-actions">
        <button @click="refreshData" class="btn btn-primary" :disabled="loading">
          {{ loading ? '刷新中...' : '🔄 刷新数据' }}
        </button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon">📊</div>
        <div class="stat-content">
          <div class="stat-value">{{ formatNumber(stats.totalRequests) }}</div>
          <div class="stat-label">总请求数</div>
          <div class="stat-trend" v-if="stats.todayRequests">
            今日: {{ formatNumber(stats.todayRequests) }}
          </div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🤖</div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.activeWorkers }}/{{ stats.totalWorkers }}</div>
          <div class="stat-label">Worker状态</div>
          <div class="stat-trend">
            {{ stats.activeWorkers > 0 ? '在线' : '离线' }}
          </div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">🚫</div>
        <div class="stat-content">
          <div class="stat-value">{{ formatNumber(stats.blockedIPs) }}</div>
          <div class="stat-label">封禁IP</div>
          <div class="stat-trend" v-if="stats.todayBlocked">
            今日: {{ formatNumber(stats.todayBlocked) }}
          </div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">✅</div>
        <div class="stat-content">
          <div class="stat-value">{{ stats.successRate }}%</div>
          <div class="stat-label">成功率</div>
          <div class="stat-trend">
            {{ stats.successRate >= 95 ? '优秀' : stats.successRate >= 80 ? '良好' : '需改进' }}
          </div>
        </div>
      </div>
    </div>

    <!-- 图表区域 -->
    <div class="charts-grid">
      <!-- 请求趋势图 -->
      <div class="chart-card full-width">
        <div class="card-header">
          <h3>📈 请求趋势</h3>
          <span class="card-subtitle">最近24小时</span>
        </div>
        <div class="card-body">
          <div ref="requestTrendChart" class="chart-container"></div>
        </div>
      </div>

      <!-- Worker状态 -->
      <div class="chart-card">
        <div class="card-header">
          <h3>🔄 Worker状态</h3>
        </div>
        <div class="card-body">
          <div ref="workerStatusChart" class="chart-container"></div>
        </div>
      </div>

      <!-- UA使用分布 -->
      <div class="chart-card">
        <div class="card-header">
          <h3>📱 UA使用分布</h3>
        </div>
        <div class="card-body">
          <div ref="uaDistributionChart" class="chart-container"></div>
        </div>
      </div>

      <!-- IP封禁趋势 -->
      <div class="chart-card full-width">
        <div class="card-header">
          <h3>🚫 IP封禁趋势</h3>
          <span class="card-subtitle">最近7天</span>
        </div>
        <div class="card-body">
          <div ref="ipBlockChart" class="chart-container"></div>
        </div>
      </div>
    </div>

    <!-- 加载提示 -->
    <div v-if="loading" class="loading-overlay">
      <div class="loading-spinner"></div>
      <p>加载数据中...</p>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, onUnmounted } from 'vue'
import { authFetch } from '../utils/api.js'
import * as echarts from 'echarts'

export default {
  name: 'Dashboard',
  setup() {
    const loading = ref(false)
    const stats = ref({
      totalRequests: 0,
      todayRequests: 0,
      activeWorkers: 0,
      totalWorkers: 0,
      blockedIPs: 0,
      todayBlocked: 0,
      successRate: 0
    })

    const requestTrendChart = ref(null)
    const workerStatusChart = ref(null)
    const ipBlockChart = ref(null)
    const uaDistributionChart = ref(null)

    let requestTrendInstance = null
    let workerStatusInstance = null
    let ipBlockInstance = null
    let uaDistributionInstance = null
    let refreshTimer = null

    // 格式化数字
    const formatNumber = (num) => {
      if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M'
      } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K'
      }
      return num.toString()
    }

    // 加载统计数据
    const loadStats = async () => {
      try {
        const response = await authFetch('/api/stats/summary')
        if (response.ok) {
          const data = await response.json()
          stats.value = {
            totalRequests: data.totalRequests || 0,
            todayRequests: data.todayRequests || 0,
            activeWorkers: data.onlineWorkers || 0,
            totalWorkers: data.totalWorkers || 0,
            blockedIPs: data.blockedIPs || 0,
            todayBlocked: data.todayBlocked || 0,
            successRate: data.successRate || 0
          }
        }

        // 如果数据库没有数据，尝试从Worker获取实时数据
        if (stats.value.totalRequests === 0) {
          await loadRealtimeStats()
        }
      } catch (error) {
        console.error('加载统计数据失败:', error)
      }
    }

    // 加载Worker实时数据
    const loadRealtimeStats = async () => {
      try {
        const response = await authFetch('/api/web-config/worker/realtime-stats')
        if (response.ok) {
          const data = await response.json()
          if (data.success && data.stats) {
            const workerStats = data.stats
            stats.value = {
              totalRequests: workerStats.requests_total || 0,
              todayRequests: workerStats.requests_total || 0,
              activeWorkers: 1,
              totalWorkers: 1,
              blockedIPs: workerStats.rate_limit_stats?.blocked_ips_count || 0,
              todayBlocked: workerStats.rate_limit_stats?.blocked_ips_count || 0,
              successRate: 100
            }
          }
        }
      } catch (error) {
        console.warn('获取Worker实时数据失败:', error)
      }
    }

    // 初始化请求趋势图
    const initRequestTrendChart = () => {
      if (!requestTrendChart.value) return

      requestTrendInstance = echarts.init(requestTrendChart.value)
      
      const option = {
        tooltip: {
          trigger: 'axis'
        },
        grid: {
          left: '3%',
          right: '4%',
          bottom: '3%',
          containLabel: true
        },
        xAxis: {
          type: 'category',
          boundaryGap: false,
          data: []
        },
        yAxis: {
          type: 'value'
        },
        series: [
          {
            name: '请求数',
            type: 'line',
            smooth: true,
            data: [],
            areaStyle: {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [{
                  offset: 0, color: 'rgba(58, 77, 233, 0.3)'
                }, {
                  offset: 1, color: 'rgba(58, 77, 233, 0.05)'
                }]
              }
            },
            lineStyle: {
              color: '#3a4de9'
            },
            itemStyle: {
              color: '#3a4de9'
            }
          }
        ]
      }

      requestTrendInstance.setOption(option)
    }

    // 初始化Worker状态图
    const initWorkerStatusChart = () => {
      if (!workerStatusChart.value) return

      workerStatusInstance = echarts.init(workerStatusChart.value)

      const option = {
        tooltip: {
          trigger: 'item',
          formatter: '{b}: {c} ({d}%)'
        },
        legend: {
          orient: 'vertical',
          left: 'left'
        },
        series: [
          {
            name: 'Worker状态',
            type: 'pie',
            radius: ['40%', '70%'],
            avoidLabelOverlap: false,
            itemStyle: {
              borderRadius: 10,
              borderColor: '#fff',
              borderWidth: 2
            },
            label: {
              show: false,
              position: 'center'
            },
            emphasis: {
              label: {
                show: true,
                fontSize: 20,
                fontWeight: 'bold'
              }
            },
            labelLine: {
              show: false
            },
            data: [
              { value: stats.value.activeWorkers, name: '在线', itemStyle: { color: '#52c41a' } },
              { value: Math.max(0, stats.value.totalWorkers - stats.value.activeWorkers), name: '离线', itemStyle: { color: '#ff4d4f' } }
            ]
          }
        ]
      }

      workerStatusInstance.setOption(option)
    }

    // 初始化UA使用分布图
    const initUADistributionChart = () => {
      if (!uaDistributionChart.value) return

      uaDistributionInstance = echarts.init(uaDistributionChart.value)

      const option = {
        tooltip: {
          trigger: 'item',
          formatter: '{b}: {c} ({d}%)'
        },
        legend: {
          orient: 'vertical',
          left: 'left'
        },
        series: [
          {
            name: 'UA类型',
            type: 'pie',
            radius: '60%',
            data: [
              { value: 0, name: 'Android' },
              { value: 0, name: 'iOS' },
              { value: 0, name: 'Web' },
              { value: 0, name: 'Other' }
            ],
            emphasis: {
              itemStyle: {
                shadowBlur: 10,
                shadowOffsetX: 0,
                shadowColor: 'rgba(0, 0, 0, 0.5)'
              }
            }
          }
        ]
      }

      uaDistributionInstance.setOption(option)
    }

    // 初始化IP封禁趋势图
    const initIPBlockChart = () => {
      if (!ipBlockChart.value) return

      ipBlockInstance = echarts.init(ipBlockChart.value)

      const option = {
        tooltip: {
          trigger: 'axis',
          axisPointer: {
            type: 'shadow'
          }
        },
        grid: {
          left: '3%',
          right: '4%',
          bottom: '3%',
          containLabel: true
        },
        xAxis: {
          type: 'category',
          data: []
        },
        yAxis: {
          type: 'value'
        },
        series: [
          {
            name: '封禁IP数',
            type: 'bar',
            data: [],
            itemStyle: {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [{
                  offset: 0, color: '#ff6b6b'
                }, {
                  offset: 1, color: '#ee5a52'
                }]
              }
            }
          }
        ]
      }

      ipBlockInstance.setOption(option)
    }

    // 刷新数据
    const refreshData = async () => {
      loading.value = true
      try {
        await loadStats()
        // 更新图表数据
        updateCharts()
      } finally {
        loading.value = false
      }
    }

    // 加载图表数据
    const loadChartData = async () => {
      try {
        // 加载请求趋势数据
        await loadRequestTrendData()

        // 加载UA使用分布数据
        await loadUADistributionData()

        // 加载IP封禁趋势数据
        await loadIPBlockTrendData()

        // 更新Worker状态图
        updateWorkerStatusChart()
      } catch (error) {
        console.error('加载图表数据失败:', error)
      }
    }

    // 加载请求趋势数据
    const loadRequestTrendData = async () => {
      try {
        const response = await authFetch('/api/stats/requests?hours=24')
        if (response.ok) {
          const data = await response.json()

          // 生成最近24小时的时间标签
          const hours = []
          const values = []
          const now = new Date()

          for (let i = 23; i >= 0; i--) {
            const hour = new Date(now.getTime() - i * 3600000)
            hours.push(hour.getHours() + ':00')

            // 从数据中查找对应小时的请求数
            const hourData = data.find(d => {
              const dataHour = new Date(d.date_hour || d.created_at).getHours()
              return dataHour === hour.getHours()
            })

            values.push(hourData ? (hourData.total_requests || 0) : 0)
          }

          if (requestTrendInstance) {
            requestTrendInstance.setOption({
              xAxis: { data: hours },
              series: [{ data: values }]
            })
          }
        }
      } catch (error) {
        console.warn('加载请求趋势数据失败:', error)
      }
    }

    // 加载UA使用分布数据
    const loadUADistributionData = async () => {
      try {
        const response = await authFetch('/api/stats/ua-usage?hours=24')
        if (response.ok) {
          const data = await response.json()

          if (uaDistributionInstance && data.length > 0) {
            uaDistributionInstance.setOption({
              series: [{
                data: data.map(item => ({
                  value: item.request_count || 0,
                  name: item.ua_type || 'Unknown'
                }))
              }]
            })
          }
        }
      } catch (error) {
        console.warn('加载UA使用分布数据失败:', error)
      }
    }

    // 加载IP封禁趋势数据
    const loadIPBlockTrendData = async () => {
      try {
        const response = await authFetch('/api/stats/violations?limit=7')
        if (response.ok) {
          const data = await response.json()

          if (ipBlockInstance && data.length > 0) {
            const dates = data.map(item => {
              const date = new Date(item.last_violation || item.created_at)
              return `${date.getMonth() + 1}/${date.getDate()}`
            })
            const counts = data.map(item => item.violation_count || 0)

            ipBlockInstance.setOption({
              xAxis: { data: dates },
              series: [{ data: counts }]
            })
          }
        }
      } catch (error) {
        console.warn('加载IP封禁趋势数据失败:', error)
      }
    }

    // 更新Worker状态图
    const updateWorkerStatusChart = () => {
      if (workerStatusInstance) {
        workerStatusInstance.setOption({
          series: [{
            data: [
              { value: stats.value.activeWorkers, name: '在线', itemStyle: { color: '#52c41a' } },
              { value: Math.max(0, stats.value.totalWorkers - stats.value.activeWorkers), name: '离线', itemStyle: { color: '#ff4d4f' } }
            ]
          }]
        })
      }
    }

    // 更新图表
    const updateCharts = async () => {
      await loadChartData()
    }

    onMounted(async () => {
      await loadStats()

      // 初始化所有图表
      initRequestTrendChart()
      initWorkerStatusChart()
      initUADistributionChart()
      initIPBlockChart()

      // 加载图表数据
      await loadChartData()

      // 不设置自动刷新，只在手动点击刷新或Worker同步数据后更新
      // refreshTimer = setInterval(refreshData, 30000)
    })

    onUnmounted(() => {
      if (refreshTimer) {
        clearInterval(refreshTimer)
      }
      if (requestTrendInstance) requestTrendInstance.dispose()
      if (workerStatusInstance) workerStatusInstance.dispose()
      if (ipBlockInstance) ipBlockInstance.dispose()
      if (uaDistributionInstance) uaDistributionInstance.dispose()
    })

    return {
      loading,
      stats,
      requestTrendChart,
      workerStatusChart,
      ipBlockChart,
      uaDistributionChart,
      formatNumber,
      refreshData
    }
  }
}
</script>

<style scoped>
.dashboard {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
  background: #f5f5f5;
  min-height: calc(100vh - 64px);
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  padding: 24px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.header-content h1 {
  color: #333;
  margin: 0 0 8px 0;
  font-size: 28px;
}

.header-content p {
  color: #666;
  margin: 0;
  font-size: 14px;
}

.header-actions .btn {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.3s;
}

.btn-primary {
  background: #3a4de9;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #2a3dd9;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
  margin-bottom: 24px;
}

.stat-card {
  background: white;
  padding: 24px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  display: flex;
  align-items: center;
  gap: 16px;
  transition: transform 0.3s, box-shadow 0.3s;
}

.stat-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
}

.stat-icon {
  font-size: 48px;
  line-height: 1;
}

.stat-content {
  flex: 1;
}

.stat-value {
  font-size: 32px;
  font-weight: bold;
  color: #333;
  margin-bottom: 4px;
}

.stat-label {
  font-size: 14px;
  color: #666;
  margin-bottom: 4px;
}

.stat-trend {
  font-size: 12px;
  color: #999;
}

.charts-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

.chart-card {
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  overflow: hidden;
}

.chart-card.full-width {
  grid-column: 1 / -1;
}

.card-header {
  padding: 16px 20px;
  border-bottom: 1px solid #eee;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-header h3 {
  margin: 0;
  font-size: 16px;
  color: #333;
}

.card-subtitle {
  font-size: 12px;
  color: #999;
}

.card-body {
  padding: 20px;
}

.chart-container {
  width: 100%;
  height: 300px;
}

.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 9999;
}

.loading-spinner {
  width: 50px;
  height: 50px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #3a4de9;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.loading-overlay p {
  color: white;
  margin-top: 16px;
  font-size: 16px;
}

@media (max-width: 768px) {
  .charts-grid {
    grid-template-columns: 1fr;
  }

  .chart-card.full-width {
    grid-column: 1;
  }
}
</style>

