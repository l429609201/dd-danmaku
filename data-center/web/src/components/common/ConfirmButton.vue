<template>
  <el-popconfirm
    :title="title"
    :confirm-button-text="confirmText"
    :cancel-button-text="cancelText"
    :confirm-button-type="confirmButtonType"
    :cancel-button-type="cancelButtonType"
    :icon="icon"
    :icon-color="iconColor"
    :hide-icon="hideIcon"
    :width="width"
    @confirm="handleConfirm"
    @cancel="handleCancel"
  >
    <template #reference>
      <el-button
        :type="type"
        :size="size"
        :plain="plain"
        :round="round"
        :circle="circle"
        :loading="loading"
        :disabled="disabled"
        :icon="buttonIcon"
        :text="text"
        :bg="bg"
      >
        <slot>{{ buttonText }}</slot>
      </el-button>
    </template>
  </el-popconfirm>
</template>

<script setup>
import { QuestionFilled } from '@element-plus/icons-vue'

const props = defineProps({
  // 提示标题
  title: {
    type: String,
    default: '确定要执行此操作吗？'
  },
  // 确认按钮文本
  confirmText: {
    type: String,
    default: '确定'
  },
  // 取消按钮文本
  cancelText: {
    type: String,
    default: '取消'
  },
  // 确认按钮类型
  confirmButtonType: {
    type: String,
    default: 'primary'
  },
  // 取消按钮类型
  cancelButtonType: {
    type: String,
    default: 'default'
  },
  // 图标
  icon: {
    type: Object,
    default: () => QuestionFilled
  },
  // 图标颜色
  iconColor: {
    type: String,
    default: '#f90'
  },
  // 隐藏图标
  hideIcon: {
    type: Boolean,
    default: false
  },
  // 弹窗宽度
  width: {
    type: [String, Number],
    default: 220
  },
  // 按钮类型
  type: {
    type: String,
    default: 'default'
  },
  // 按钮尺寸
  size: {
    type: String,
    default: 'default'
  },
  // 朴素按钮
  plain: {
    type: Boolean,
    default: false
  },
  // 圆角按钮
  round: {
    type: Boolean,
    default: false
  },
  // 圆形按钮
  circle: {
    type: Boolean,
    default: false
  },
  // 加载状态
  loading: {
    type: Boolean,
    default: false
  },
  // 禁用状态
  disabled: {
    type: Boolean,
    default: false
  },
  // 按钮图标
  buttonIcon: {
    type: Object,
    default: undefined
  },
  // 按钮文本
  buttonText: {
    type: String,
    default: ''
  },
  // 文字按钮
  text: {
    type: Boolean,
    default: false
  },
  // 背景色
  bg: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['confirm', 'cancel'])

// 确认
const handleConfirm = () => {
  emit('confirm')
}

// 取消
const handleCancel = () => {
  emit('cancel')
}
</script>

<style scoped>
/* 样式继承自 Element Plus */
</style>
