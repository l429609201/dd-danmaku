<template>
  <el-dialog
    v-model="dialogVisible"
    :title="title"
    :width="width"
    :top="top"
    :modal="modal"
    :close-on-click-modal="closeOnClickModal"
    :close-on-press-escape="closeOnPressEscape"
    :show-close="showClose"
    :before-close="handleBeforeClose"
    :destroy-on-close="destroyOnClose"
    class="form-dialog"
  >
    <!-- 表单内容 -->
    <el-form
      ref="formRef"
      :model="formData"
      :rules="rules"
      :label-width="labelWidth"
      :label-position="labelPosition"
      :size="size"
      class="form-dialog__form"
    >
      <slot :form="formData"></slot>
    </el-form>

    <!-- 底部按钮 -->
    <template #footer>
      <div class="form-dialog__footer">
        <el-button @click="handleCancel" :disabled="loading">
          {{ cancelText }}
        </el-button>
        <el-button
          type="primary"
          @click="handleConfirm"
          :loading="loading"
          :disabled="disabled"
        >
          {{ confirmText }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  // 是否显示
  modelValue: {
    type: Boolean,
    required: true
  },
  // 标题
  title: {
    type: String,
    default: '表单'
  },
  // 宽度
  width: {
    type: [String, Number],
    default: '600px'
  },
  // 距离顶部
  top: {
    type: String,
    default: '15vh'
  },
  // 是否显示遮罩
  modal: {
    type: Boolean,
    default: true
  },
  // 点击遮罩是否关闭
  closeOnClickModal: {
    type: Boolean,
    default: false
  },
  // 按下 ESC 是否关闭
  closeOnPressEscape: {
    type: Boolean,
    default: true
  },
  // 显示关闭按钮
  showClose: {
    type: Boolean,
    default: true
  },
  // 关闭时销毁
  destroyOnClose: {
    type: Boolean,
    default: false
  },
  // 表单数据
  formData: {
    type: Object,
    required: true
  },
  // 表单验证规则
  rules: {
    type: Object,
    default: () => ({})
  },
  // 标签宽度
  labelWidth: {
    type: [String, Number],
    default: '100px'
  },
  // 标签位置
  labelPosition: {
    type: String,
    default: 'right'
  },
  // 表单尺寸
  size: {
    type: String,
    default: 'default'
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
  // 加载状态
  loading: {
    type: Boolean,
    default: false
  },
  // 禁用确认按钮
  disabled: {
    type: Boolean,
    default: false
  },
  // 关闭前回调
  beforeClose: {
    type: Function,
    default: undefined
  }
})

const emit = defineEmits([
  'update:modelValue',
  'confirm',
  'cancel',
  'close'
])

const formRef = ref(null)
const dialogVisible = ref(props.modelValue)

// 监听 modelValue 变化
watch(() => props.modelValue, (val) => {
  dialogVisible.value = val
})

// 监听 dialogVisible 变化
watch(dialogVisible, (val) => {
  emit('update:modelValue', val)
  if (!val) {
    emit('close')
  }
})

// 关闭前处理
const handleBeforeClose = (done) => {
  if (props.beforeClose) {
    props.beforeClose(done)
  } else {
    done()
  }
}

// 取消
const handleCancel = () => {
  dialogVisible.value = false
  emit('cancel')
}

// 确认
const handleConfirm = async () => {
  if (!formRef.value) return

  try {
    // 验证表单
    await formRef.value.validate()
    emit('confirm', props.formData)
  } catch (error) {
    console.error('表单验证失败:', error)
  }
}

// 重置表单
const resetFields = () => {
  formRef.value?.resetFields()
}

// 清空验证
const clearValidate = () => {
  formRef.value?.clearValidate()
}

// 验证表单
const validate = () => {
  return formRef.value?.validate()
}

// 暴露方法
defineExpose({
  resetFields,
  clearValidate,
  validate
})
</script>

<style scoped>
.form-dialog :deep(.el-dialog__body) {
  padding: var(--spacing-lg) var(--spacing-lg) var(--spacing-md);
}

.form-dialog__form {
  max-height: 60vh;
  overflow-y: auto;
  padding-right: var(--spacing-sm);
}

.form-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
}

/* 移动端适配 */
@media (max-width: 768px) {
  .form-dialog :deep(.el-dialog) {
    width: 90% !important;
    margin-top: 5vh !important;
  }

  .form-dialog__form {
    max-height: 50vh;
  }
}
</style>
