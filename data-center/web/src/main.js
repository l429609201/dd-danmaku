import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

// Element Plus（之前装了未启用，本次正式接入）
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

// 全局设计 token / 基线样式
import './styles/theme.css'

const app = createApp(App)

// 注册全部 Element Plus 图标为全局组件
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.use(ElementPlus, { locale: zhCn })
app.use(router)
app.mount('#app')
