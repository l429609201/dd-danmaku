<template>
  <div class="data-table">
    <!-- 工具栏 -->
    <div v-if="$slots.toolbar || showSearch" class="data-table__toolbar">
      <slot name="toolbar"></slot>
      
      <!-- 搜索框 -->
      <el-input
        v-if="showSearch"
        v-model="searchText"
        :placeholder="searchPlaceholder"
        clearable
        class="search-input"
        @input="handleSearch"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
    </div>

    <!-- 表格 -->
    <el-table
      ref="tableRef"
      v-loading="loading"
      :data="tableData"
      :stripe="stripe"
      :border="border"
      :size="size"
      :height="height"
      :max-height="maxHeight"
      :row-key="rowKey"
      :empty-text="emptyText"
      @selection-change="handleSelectionChange"
      @sort-change="handleSortChange"
      class="data-table__table"
    >
      <!-- 多选列 -->
      <el-table-column
        v-if="showSelection"
        type="selection"
        width="55"
        :selectable="selectable"
      />

      <!-- 序号列 -->
      <el-table-column
        v-if="showIndex"
        type="index"
        label="序号"
        width="80"
        :index="indexMethod"
      />

      <!-- 动态列 -->
      <el-table-column
        v-for="column in columns"
        :key="column.prop"
        :prop="column.prop"
        :label="column.label"
        :width="column.width"
        :min-width="column.minWidth"
        :fixed="column.fixed"
        :sortable="column.sortable"
        :align="column.align || 'left'"
        :show-overflow-tooltip="column.showOverflowTooltip !== false"
      >
        <template #default="scope">
          <!-- 自定义插槽 -->
          <slot
            v-if="column.slot"
            :name="column.slot"
            :row="scope.row"
            :column="column"
            :$index="scope.$index"
          ></slot>
          
          <!-- 默认渲染 -->
          <span v-else>{{ scope.row[column.prop] }}</span>
        </template>
      </el-table-column>

      <!-- 操作列 -->
      <el-table-column
        v-if="$slots.actions"
        label="操作"
        :width="actionsWidth"
        :fixed="actionsFixed"
        align="center"
      >
        <template #default="scope">
          <slot name="actions" :row="scope.row" :$index="scope.$index"></slot>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
    <div v-if="showPagination" class="data-table__pagination">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="pageSizes"
        :total="total"
        :layout="paginationLayout"
        :background="true"
        @size-change="handleSizeChange"
        @current-change="handleCurrentChange"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { debounce } from '@/utils/debounce'

const props = defineProps({
  // 数据源
  data: {
    type: Array,
    default: () => []
  },
  // 列配置
  columns: {
    type: Array,
    required: true
  },
  // 加载状态
  loading: {
    type: Boolean,
    default: false
  },
  // 显示斑马纹
  stripe: {
    type: Boolean,
    default: true
  },
  // 显示边框
  border: {
    type: Boolean,
    default: false
  },
  // 表格尺寸
  size: {
    type: String,
    default: 'default'
  },
  // 表格高度
  height: {
    type: [String, Number],
    default: undefined
  },
  // 最大高度
  maxHeight: {
    type: [String, Number],
    default: undefined
  },
  // 行 key
  rowKey: {
    type: [String, Function],
    default: 'id'
  },
  // 空数据文本
  emptyText: {
    type: String,
    default: '暂无数据'
  },
  // 显示多选
  showSelection: {
    type: Boolean,
    default: false
  },
  // 多选可选判断
  selectable: {
    type: Function,
    default: undefined
  },
  // 显示序号
  showIndex: {
    type: Boolean,
    default: false
  },
  // 序号方法
  indexMethod: {
    type: Function,
    default: (index) => index + 1
  },
  // 操作列宽度
  actionsWidth: {
    type: [String, Number],
    default: 200
  },
  // 操作列固定
  actionsFixed: {
    type: String,
    default: 'right'
  },
  // 显示搜索
  showSearch: {
    type: Boolean,
    default: false
  },
  // 搜索占位符
  searchPlaceholder: {
    type: String,
    default: '请输入搜索内容'
  },
  // 显示分页
  showPagination: {
    type: Boolean,
    default: true
  },
  // 分页布局
  paginationLayout: {
    type: String,
    default: 'total, sizes, prev, pager, next, jumper'
  },
  // 每页大小选项
  pageSizes: {
    type: Array,
    default: () => [10, 20, 50, 100]
  },
  // 总数
  total: {
    type: Number,
    default: 0
  },
  // 当前页
  page: {
    type: Number,
    default: 1
  },
  // 每页大小
  limit: {
    type: Number,
    default: 20
  }
})

const emit = defineEmits([
  'update:page',
  'update:limit',
  'selection-change',
  'sort-change',
  'search',
  'refresh'
])

const tableRef = ref(null)
const searchText = ref('')
const currentPage = ref(props.page)
const pageSize = ref(props.limit)

// 表格数据（支持前端分页）
const tableData = computed(() => {
  return props.data
})

// 监听页码变化
watch(() => props.page, (val) => {
  currentPage.value = val
})

watch(() => props.limit, (val) => {
  pageSize.value = val
})

// 多选变化
const handleSelectionChange = (selection) => {
  emit('selection-change', selection)
}

// 排序变化
const handleSortChange = ({ prop, order }) => {
  emit('sort-change', { prop, order })
}

// 搜索（防抖）
const handleSearch = debounce((value) => {
  emit('search', value)
}, 300)

// 每页大小变化
const handleSizeChange = (size) => {
  pageSize.value = size
  emit('update:limit', size)
  emit('refresh')
}

// 当前页变化
const handleCurrentChange = (page) => {
  currentPage.value = page
  emit('update:page', page)
  emit('refresh')
}

// 清空多选
const clearSelection = () => {
  tableRef.value?.clearSelection()
}

// 切换行选中
const toggleRowSelection = (row, selected) => {
  tableRef.value?.toggleRowSelection(row, selected)
}

// 暴露方法
defineExpose({
  clearSelection,
  toggleRowSelection
})
</script>

<style scoped>
.data-table {
  width: 100%;
}

.data-table__toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-md);
  gap: var(--spacing-md);
}

.search-input {
  width: 300px;
}

.data-table__table {
  width: 100%;
}

.data-table__pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--spacing-md);
}

/* 移动端适配 */
@media (max-width: 768px) {
  .data-table__toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .search-input {
    width: 100%;
  }

  .data-table__pagination {
    justify-content: center;
  }
}
</style>
