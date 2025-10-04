<template>
  <div class="config-page">
    <h2>配置管理</h2>
    <p>系统配置管理页面</p>
    
    <el-card>
      <template #header>
        <span>基本配置</span>
      </template>
      <el-form label-width="120px">
        <el-form-item label="系统名称">
          <el-input v-model="config.systemName" />
        </el-form-item>
        <el-form-item label="API端口">
          <el-input-number v-model="config.apiPort" :min="1000" :max="65535" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary">保存配置</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script>
import { ref } from 'vue'

export default {
  name: 'Config',
  setup() {
    const config = ref({
      systemName: 'DanDanPlay 数据交互中心',
      apiPort: 7759
    })
    
    return {
      config
    }
  }
}
</script>

<style scoped>
.config-page {
  padding: 20px;
}
</style>
