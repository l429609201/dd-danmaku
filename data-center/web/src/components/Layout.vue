<template>
  <div class="layout">
    <nav class="sidebar">
      <div class="logo">
        <h2>🎯 DanDanPlay</h2>
        <p>数据交互中心</p>
      </div>
      
      <ul class="nav-menu">
        <li>
          <router-link to="/" class="nav-link" :class="{ active: $route.path === '/' }">
            📊 仪表板
          </router-link>
        </li>
        <li>
          <router-link to="/config" class="nav-link" :class="{ active: $route.path === '/config' }">
            ⚙️ 配置管理
          </router-link>
        </li>
        <li>
          <router-link to="/stats" class="nav-link" :class="{ active: $route.path === '/stats' }">
            📈 统计数据
          </router-link>
        </li>
        <li>
          <router-link to="/logs" class="nav-link" :class="{ active: $route.path === '/logs' }">
            📋 日志管理
          </router-link>
        </li>
      </ul>
      
      <div class="user-section">
        <div class="user-info">
          <span class="username">{{ username }}</span>
          <button @click="logout" class="logout-btn">🚪 退出</button>
        </div>
      </div>
    </nav>
    
    <main class="main-content">
      <router-view />
    </main>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { logout as apiLogout } from '../utils/api.js'

export default {
  name: 'Layout',
  setup() {
    const router = useRouter()
    const username = ref('admin')
    
    const logout = () => {
      if (confirm('确定要退出登录吗？')) {
        apiLogout()
      }
    }
    
    onMounted(() => {
      // 检查登录状态
      const token = localStorage.getItem('access_token')
      if (!token) {
        router.push('/login')
      }
    })
    
    return {
      username,
      logout
    }
  }
}
</script>

<style scoped>
.layout {
  display: flex;
  height: 100vh;
}

.sidebar {
  width: 250px;
  background: #2c3e50;
  color: white;
  display: flex;
  flex-direction: column;
  box-shadow: 2px 0 8px rgba(0,0,0,0.1);
}

.logo {
  padding: 20px;
  border-bottom: 1px solid #34495e;
  text-align: center;
}

.logo h2 {
  margin-bottom: 4px;
  font-size: 18px;
}

.logo p {
  font-size: 12px;
  color: #bdc3c7;
}

.nav-menu {
  flex: 1;
  list-style: none;
  padding: 20px 0;
}

.nav-menu li {
  margin-bottom: 4px;
}

.nav-link {
  display: block;
  padding: 12px 20px;
  color: #bdc3c7;
  text-decoration: none;
  transition: all 0.3s;
  border-left: 3px solid transparent;
}

.nav-link:hover {
  background: #34495e;
  color: white;
  border-left-color: #3498db;
}

.nav-link.active {
  background: #34495e;
  color: white;
  border-left-color: #3498db;
}

.user-section {
  padding: 20px;
  border-top: 1px solid #34495e;
}

.user-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.username {
  color: #bdc3c7;
  font-size: 14px;
}

.logout-btn {
  background: #e74c3c;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.3s;
}

.logout-btn:hover {
  background: #c0392b;
}

.main-content {
  flex: 1;
  overflow-y: auto;
  background: #f5f5f5;
}
</style>
