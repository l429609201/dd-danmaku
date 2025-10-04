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
          <div class="user-dropdown">
            <button @click="toggleDropdown" class="user-btn">
              👤 <span class="dropdown-arrow" :class="{ open: showDropdown }">▼</span>
            </button>
            <div v-if="showDropdown" class="dropdown-menu">
              <router-link to="/change-password" class="dropdown-item" @click="closeDropdown">
                🔐 修改密码
              </router-link>
              <button @click="logout" class="dropdown-item logout-item">
                🚪 退出登录
              </button>
            </div>
          </div>
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
    const showDropdown = ref(false)

    const toggleDropdown = () => {
      showDropdown.value = !showDropdown.value
    }

    const closeDropdown = () => {
      showDropdown.value = false
    }

    const logout = () => {
      closeDropdown()
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
    
    // 点击外部关闭下拉菜单
    onMounted(() => {
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.user-dropdown')) {
          showDropdown.value = false
        }
      })
    })

    return {
      username,
      showDropdown,
      toggleDropdown,
      closeDropdown,
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

.user-dropdown {
  position: relative;
}

.user-btn {
  background: #e74c3c;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  gap: 6px;
}

.user-btn:hover {
  background: #c0392b;
}

.dropdown-arrow {
  font-size: 10px;
  transition: transform 0.3s ease;
}

.dropdown-arrow.open {
  transform: rotate(180deg);
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  min-width: 150px;
  z-index: 1000;
  margin-top: 8px;
  overflow: hidden;
}

.dropdown-item {
  display: block;
  width: 100%;
  padding: 12px 16px;
  color: #333;
  text-decoration: none;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 14px;
  text-align: left;
  transition: background-color 0.2s ease;
}

.dropdown-item:hover {
  background: #f8f9fa;
}

.logout-item {
  border-top: 1px solid #e9ecef;
  color: #dc3545;
}

.logout-item:hover {
  background: #f8d7da;
}

.main-content {
  flex: 1;
  overflow-y: auto;
  background: #f5f5f5;
}
</style>
