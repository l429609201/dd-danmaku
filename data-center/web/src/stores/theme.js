import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export const useThemeStore = defineStore('theme', () => {
  // 从 localStorage 读取初始主题
  const isDark = ref(localStorage.getItem('theme') === 'dark')
  
  // 侧边栏折叠状态
  const sidebarCollapsed = ref(localStorage.getItem('sidebarCollapsed') === 'true')
  
  // 移动端状态
  const isMobile = ref(false)
  const mobileMenuOpen = ref(false)

  // 切换主题
  const toggleTheme = () => {
    isDark.value = !isDark.value
  }

  // 设置主题
  const setTheme = (dark) => {
    isDark.value = dark
  }

  // 切换侧边栏
  const toggleSidebar = () => {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  // 设置移动端状态
  const setMobile = (mobile) => {
    isMobile.value = mobile
    if (!mobile) {
      mobileMenuOpen.value = false
    }
  }

  // 切换移动端菜单
  const toggleMobileMenu = () => {
    mobileMenuOpen.value = !mobileMenuOpen.value
  }

  // 关闭移动端菜单
  const closeMobileMenu = () => {
    mobileMenuOpen.value = false
  }

  // 监听主题变化，更新 DOM 和 localStorage
  watch(isDark, (dark) => {
    if (dark) {
      document.documentElement.setAttribute('data-theme', 'dark')
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, { immediate: true })

  // 监听侧边栏状态，更新 localStorage
  watch(sidebarCollapsed, (collapsed) => {
    localStorage.setItem('sidebarCollapsed', collapsed.toString())
  })

  return {
    isDark,
    sidebarCollapsed,
    isMobile,
    mobileMenuOpen,
    toggleTheme,
    setTheme,
    toggleSidebar,
    setMobile,
    toggleMobileMenu,
    closeMobileMenu,
  }
})
