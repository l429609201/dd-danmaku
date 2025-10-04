<template>
  <div class="logs-page">
    <h2>日志管理</h2>
    <p>系统日志管理页面</p>
    
    <el-card>
      <template #header>
        <span>系统日志</span>
      </template>
      <el-table :data="logsData" style="width: 100%">
        <el-table-column prop="timestamp" label="时间" width="180" />
        <el-table-column prop="level" label="级别" width="80" />
        <el-table-column prop="message" label="消息" />
      </el-table>
    </el-card>
  </div>
</template>

<script>
import { ref } from 'vue'

export default {
  name: 'Logs',
  setup() {
    const logsData = ref([
      { timestamp: '2024-01-01 12:00:00', level: 'INFO', message: '系统启动成功' },
      { timestamp: '2024-01-01 12:01:00', level: 'WARN', message: '配置文件未找到，使用默认配置' },
      { timestamp: '2024-01-01 12:02:00', level: 'ERROR', message: '数据库连接失败' }
    ])
    
    return {
      logsData
    }
  }
}
</script>

<style scoped>
.logs-page {
  padding: 20px;
}
</style>
