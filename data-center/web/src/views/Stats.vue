<template>
  <div class="stats-page">
    <h2>统计数据</h2>
    <p>系统统计数据页面</p>
    
    <el-card>
      <template #header>
        <span>数据统计</span>
      </template>
      <el-table :data="statsData" style="width: 100%">
        <el-table-column prop="name" label="指标名称" />
        <el-table-column prop="value" label="数值" />
        <el-table-column prop="unit" label="单位" />
      </el-table>
    </el-card>
  </div>
</template>

<script>
import { ref } from 'vue'

export default {
  name: 'Stats',
  setup() {
    const statsData = ref([
      { name: '总请求数', value: 12345, unit: '次' },
      { name: '活跃用户', value: 234, unit: '人' },
      { name: '错误率', value: 2.1, unit: '%' }
    ])
    
    return {
      statsData
    }
  }
}
</script>

<style scoped>
.stats-page {
  padding: 20px;
}
</style>
