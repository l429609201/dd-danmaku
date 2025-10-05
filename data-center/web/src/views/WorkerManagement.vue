<template>
  <div class="worker-management">
    <h1>🔧 Worker管理</h1>
    <p>页面加载成功！</p>
    <p>如果您能看到这个消息，说明路由和组件都正常工作。</p>
    <p>现在可以点击其他页面测试导航是否正常。</p>
  </div>
</template>

<script>
export default {
  name: 'WorkerManagement'
}
</script>

<style scoped>
.worker-management {
  padding: 20px;
  text-align: center;
}

h1 {
  color: #333;
  margin-bottom: 20px;
}

p {
  color: #666;
  margin: 10px 0;
}
</style>
