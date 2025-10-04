<template>
  <div class="settings-page">
    <h2>系统设置</h2>
    <p>系统设置管理页面</p>
    
    <el-card>
      <template #header>
        <span>用户设置</span>
      </template>
      <el-form label-width="120px">
        <el-form-item label="用户名">
          <el-input v-model="settings.username" disabled />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="settings.email" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary">保存设置</el-button>
          <el-button type="danger">修改密码</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script>
import { ref } from 'vue'

export default {
  name: 'Settings',
  setup() {
    const settings = ref({
      username: 'admin',
      email: 'admin@example.com'
    })
    
    return {
      settings
    }
  }
}
</script>

<style scoped>
.settings-page {
  padding: 20px;
}
</style>
