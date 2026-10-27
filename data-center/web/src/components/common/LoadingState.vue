<template>
  <div class="loading-state" :class="{ 'loading-state--fullscreen': fullscreen }">
    <div class="loading-state__content">
      <!-- 加载图标 -->
      <div class="loading-state__spinner">
        <el-icon v-if="type === 'default'" class="is-loading">
          <Loading />
        </el-icon>
        <el-icon v-else-if="type === 'circle'" class="is-loading circle">
          <Loading />
        </el-icon>
        <div v-else-if="type === 'dots'" class="dots-spinner">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
      </div>

      <!-- 加载文本 -->
      <div v-if="text" class="loading-state__text">
        {{ text }}
      </div>

      <!-- 额外插槽 -->
      <div v-if="$slots.default" class="loading-state__extra">
        <slot></slot>
      </div>
    </div>

    <!-- 背景遮罩 -->
    <div v-if="background" class="loading-state__background"></div>
  </div>
</template>

<script setup>
import { Loading } from '@element-plus/icons-vue'

const props = defineProps({
  // 加载类型
  type: {
    type: String,
    default: 'default',
    validator: (value) => ['default', 'circle', 'dots'].includes(value)
  },
  // 加载文本
  text: {
    type: String,
    default: ''
  },
  // 全屏显示
  fullscreen: {
    type: Boolean,
    default: false
  },
  // 显示背景
  background: {
    type: Boolean,
    default: false
  }
})
</script>

<style scoped>
.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-xl) var(--spacing-lg);
  position: relative;
}

.loading-state--fullscreen {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background-color: rgba(255, 255, 255, 0.9);
}

[data-theme="dark"] .loading-state--fullscreen {
  background-color: rgba(0, 0, 0, 0.9);
}

.loading-state__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-md);
  position: relative;
  z-index: 1;
}

.loading-state__spinner {
  font-size: 32px;
  color: var(--color-primary);
}

.loading-state__spinner .is-loading {
  animation: rotate 1s linear infinite;
}

.loading-state__spinner .is-loading.circle {
  animation: rotate 2s linear infinite;
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* 点状加载器 */
.dots-spinner {
  display: flex;
  gap: 8px;
}

.dots-spinner .dot {
  width: 12px;
  height: 12px;
  background-color: var(--color-primary);
  border-radius: 50%;
  animation: bounce 1.4s infinite ease-in-out both;
}

.dots-spinner .dot:nth-child(1) {
  animation-delay: -0.32s;
}

.dots-spinner .dot:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes bounce {
  0%, 80%, 100% {
    transform: scale(0);
    opacity: 0.5;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

.loading-state__text {
  font-size: 14px;
  color: var(--color-text-secondary);
}

.loading-state__extra {
  margin-top: var(--spacing-sm);
}

.loading-state__background {
  position: absolute;
  inset: 0;
  background-color: rgba(255, 255, 255, 0.8);
  z-index: 0;
}

[data-theme="dark"] .loading-state__background {
  background-color: rgba(0, 0, 0, 0.8);
}
</style>
