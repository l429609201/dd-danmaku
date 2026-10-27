<template>
  <div class="empty-state" :class="{ 'empty-state--small': small }">
    <div class="empty-state__content">
      <!-- 图标 -->
      <div class="empty-state__icon">
        <el-icon v-if="icon" :size="iconSize">
          <component :is="icon" />
        </el-icon>
        <img v-else-if="image" :src="image" :alt="description" class="empty-state__image" />
        <el-icon v-else :size="iconSize">
          <Box />
        </el-icon>
      </div>

      <!-- 描述文本 -->
      <div class="empty-state__description">
        {{ description }}
      </div>

      <!-- 额外内容 -->
      <div v-if="$slots.default" class="empty-state__extra">
        <slot></slot>
      </div>

      <!-- 操作按钮 -->
      <div v-if="showAction" class="empty-state__action">
        <el-button
          :type="actionType"
          :size="actionSize"
          :icon="actionIcon"
          @click="handleAction"
        >
          {{ actionText }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { Box } from '@element-plus/icons-vue'

const props = defineProps({
  // 图标
  icon: {
    type: Object,
    default: undefined
  },
  // 图片
  image: {
    type: String,
    default: ''
  },
  // 图标大小
  iconSize: {
    type: Number,
    default: 80
  },
  // 描述文本
  description: {
    type: String,
    default: '暂无数据'
  },
  // 显示操作按钮
  showAction: {
    type: Boolean,
    default: false
  },
  // 操作按钮文本
  actionText: {
    type: String,
    default: '点击刷新'
  },
  // 操作按钮类型
  actionType: {
    type: String,
    default: 'primary'
  },
  // 操作按钮尺寸
  actionSize: {
    type: String,
    default: 'default'
  },
  // 操作按钮图标
  actionIcon: {
    type: Object,
    default: undefined
  },
  // 小尺寸
  small: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['action'])

// 操作按钮点击
const handleAction = () => {
  emit('action')
}
</script>

<style scoped>
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-xl) var(--spacing-lg);
  min-height: 300px;
}

.empty-state--small {
  min-height: 200px;
  padding: var(--spacing-lg) var(--spacing-md);
}

.empty-state__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-md);
  max-width: 400px;
  text-align: center;
}

.empty-state__icon {
  color: var(--color-text-placeholder);
  opacity: 0.5;
}

.empty-state__image {
  width: 160px;
  height: 160px;
  object-fit: contain;
  opacity: 0.6;
}

.empty-state--small .empty-state__image {
  width: 100px;
  height: 100px;
}

.empty-state__description {
  font-size: 14px;
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.empty-state--small .empty-state__description {
  font-size: 13px;
}

.empty-state__extra {
  margin-top: var(--spacing-sm);
  color: var(--color-text-placeholder);
  font-size: 12px;
}

.empty-state__action {
  margin-top: var(--spacing-sm);
}

/* 移动端适配 */
@media (max-width: 768px) {
  .empty-state {
    min-height: 250px;
    padding: var(--spacing-lg) var(--spacing-md);
  }

  .empty-state__icon {
    font-size: 64px;
  }

  .empty-state__image {
    width: 120px;
    height: 120px;
  }
}
</style>
