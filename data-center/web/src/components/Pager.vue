<template>
  <div class="pager">
    <button class="btn" :disabled="page <= 1" @click="go(page - 1)">上一页</button>
    <span>第 {{ page }} / {{ totalPages }} 页 · 共 {{ total }} 条</span>
    <button class="btn" :disabled="page >= totalPages" @click="go(page + 1)">下一页</button>
    <!-- 页码跳转 -->
    <span class="jump">
      跳至
      <input
        class="jump-input"
        type="number"
        min="1"
        :max="totalPages"
        v-model.number="jumpVal"
        @keyup.enter="doJump"
      />
      页
      <button class="btn btn-sm" @click="doJump">跳转</button>
    </span>
  </div>
</template>

<script>
import { ref, computed } from 'vue'

export default {
  name: 'Pager',
  props: {
    page: { type: Number, required: true },
    pageSize: { type: Number, default: 20 },
    total: { type: Number, default: 0 },
  },
  emits: ['update:page'],
  setup(props, { emit }) {
    const jumpVal = ref(props.page)
    // 总页数（至少 1 页）
    const totalPages = computed(() =>
      Math.max(1, Math.ceil((props.total || 0) / (props.pageSize || 1)))
    )
    const go = (p) => {
      const target = Math.min(Math.max(1, p), totalPages.value)
      if (target !== props.page) emit('update:page', target)
    }
    // 跳转到输入框页码（越界自动夹紧）
    const doJump = () => {
      const v = parseInt(jumpVal.value)
      if (!v || v < 1) { jumpVal.value = 1; return go(1) }
      go(v)
      jumpVal.value = Math.min(Math.max(1, v), totalPages.value)
    }
    return { jumpVal, totalPages, go, doJump }
  },
}
</script>

<style scoped>
.pager { display: flex; align-items: center; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
.pager span { color: #666; font-size: 13px; }
.btn { padding: 6px 14px; border: 1px solid #d9d9d9; background: #fff; border-radius: 6px;
  cursor: pointer; font-size: 13px; }
.btn:hover:not(:disabled) { border-color: #1677ff; color: #1677ff; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn-sm { padding: 4px 10px; }
.jump { display: flex; align-items: center; gap: 6px; }
.jump-input { width: 60px; padding: 5px 8px; border: 1px solid #d9d9d9; border-radius: 6px;
  text-align: center; font-size: 13px; }
.jump-input:focus { border-color: #1677ff; outline: none; }
</style>
