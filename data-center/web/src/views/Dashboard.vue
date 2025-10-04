<template>
  <div class="dashboard">
    <el-row :gutter="20">
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-item">
            <div class="stat-value">{{ stats.totalRequests }}</div>
            <div class="stat-label">总请求数</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-item">
            <div class="stat-value">{{ stats.activeWorkers }}</div>
            <div class="stat-label">活跃Worker</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-item">
            <div class="stat-value">{{ stats.blockedIPs }}</div>
            <div class="stat-label">封禁IP</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-item">
            <div class="stat-value">{{ stats.errorRate }}%</div>
            <div class="stat-label">错误率</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" style="margin-top: 20px;">
      <el-col :span="12">
        <el-card>
          <template #header>
            <span>请求趋势</span>
          </template>
          <div id="requestChart" style="height: 300px;"></div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card>
          <template #header>
            <span>Worker状态</span>
          </template>
          <div id="workerChart" style="height: 300px;"></div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import * as echarts from 'echarts'

export default {
  name: 'Dashboard',
  setup() {
    const stats = ref({
      totalRequests: 0,
      activeWorkers: 0,
      blockedIPs: 0,
      errorRate: 0
    })

    const initCharts = () => {
      // 请求趋势图
      const requestChart = echarts.init(document.getElementById('requestChart'))
      requestChart.setOption({
        title: { text: '24小时请求趋势' },
        xAxis: { type: 'category', data: [] },
        yAxis: { type: 'value' },
        series: [{ type: 'line', data: [] }]
      })

      // Worker状态图
      const workerChart = echarts.init(document.getElementById('workerChart'))
      workerChart.setOption({
        title: { text: 'Worker状态分布' },
        series: [{
          type: 'pie',
          data: [
            { name: '正常', value: 3 },
            { name: '异常', value: 1 }
          ]
        }]
      })
    }

    const loadStats = async () => {
      try {
        // 这里调用API获取统计数据
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
      setTimeout(initCharts, 100) // 延迟初始化图表
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
}

.stat-card {
  text-align: center;
}

.stat-item {
  padding: 20px;
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
</style>
