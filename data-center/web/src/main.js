import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

// 简化导入，先不使用Element Plus
const app = createApp(App)

app.use(router)

app.mount('#app')
