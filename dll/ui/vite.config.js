import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    // 仅清理管理页面产物，保留同级 ede.js 和后端源码。
    outDir: '../Resources/Admin',
    emptyOutDir: true,
  },
})
