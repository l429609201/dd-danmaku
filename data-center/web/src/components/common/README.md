# 共享组件库使用指南

## 组件列表

Phase 6 Round 24 创建的 5 个通用业务组件：

1. **DataTable** - 统一数据表格
2. **FormDialog** - 统一表单对话框
3. **ConfirmButton** - 确认操作按钮
4. **LoadingState** - 加载状态
5. **EmptyState** - 空状态

---

## 1. DataTable（数据表格）

### 基础用法

```vue
<template>
  <DataTable
    :data="tableData"
    :columns="columns"
    :loading="loading"
    :total="total"
    :page="page"
    :limit="limit"
    show-index
    show-selection
    @refresh="fetchData"
  >
    <template #actions="{ row }">
      <el-button size="small" @click="handleEdit(row)">编辑</el-button>
      <el-button size="small" type="danger" @click="handleDelete(row)">删除</el-button>
    </template>
  </DataTable>
</template>

<script setup>
import { ref } from 'vue'
import DataTable from '@/components/common/DataTable.vue'

const tableData = ref([])
const loading = ref(false)
const total = ref(0)
const page = ref(1)
const limit = ref(20)

const columns = [
  { prop: 'id', label: 'ID', width: 80 },
  { prop: 'name', label: '名称', minWidth: 150 },
  { prop: 'status', label: '状态', width: 100, slot: 'status' },
  { prop: 'createTime', label: '创建时间', width: 180 }
]

const fetchData = () => {
  loading.value = true
  // API 调用
  loading.value = false
}
</script>
```

### Props

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| data | Array | [] | 表格数据 |
| columns | Array | - | 列配置 |
| loading | Boolean | false | 加载状态 |
| stripe | Boolean | true | 斑马纹 |
| border | Boolean | false | 边框 |
| showSelection | Boolean | false | 多选列 |
| showIndex | Boolean | false | 序号列 |
| showSearch | Boolean | false | 搜索框 |
| showPagination | Boolean | true | 分页 |
| total | Number | 0 | 总数 |
| page | Number | 1 | 当前页 |
| limit | Number | 20 | 每页大小 |

### Events

| 事件 | 参数 | 说明 |
|------|------|------|
| selection-change | selection | 多选变化 |
| sort-change | { prop, order } | 排序变化 |
| search | value | 搜索 |
| refresh | - | 刷新 |

### Slots

| 插槽 | 说明 |
|------|------|
| toolbar | 工具栏 |
| actions | 操作列 |
| [column.slot] | 自定义列 |

---

## 2. FormDialog（表单对话框）

### 基础用法

```vue
<template>
  <FormDialog
    v-model="dialogVisible"
    title="编辑用户"
    :form-data="formData"
    :rules="rules"
    :loading="loading"
    @confirm="handleConfirm"
    @cancel="handleCancel"
  >
    <template #default="{ form }">
      <el-form-item label="用户名" prop="username">
        <el-input v-model="form.username" placeholder="请输入用户名" />
      </el-form-item>
      <el-form-item label="邮箱" prop="email">
        <el-input v-model="form.email" placeholder="请输入邮箱" />
      </el-form-item>
    </template>
  </FormDialog>
</template>

<script setup>
import { ref } from 'vue'
import FormDialog from '@/components/common/FormDialog.vue'

const dialogVisible = ref(false)
const loading = ref(false)

const formData = ref({
  username: '',
  email: ''
})

const rules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' }
  ],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' }
  ]
}

const handleConfirm = async (data) => {
  loading.value = true
  // API 调用
  loading.value = false
  dialogVisible.value = false
}

const handleCancel = () => {
  dialogVisible.value = false
}
</script>
```

### Props

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| modelValue | Boolean | - | 是否显示 |
| title | String | '表单' | 标题 |
| width | String/Number | '600px' | 宽度 |
| formData | Object | - | 表单数据 |
| rules | Object | {} | 验证规则 |
| labelWidth | String/Number | '100px' | 标签宽度 |
| confirmText | String | '确定' | 确认按钮文本 |
| cancelText | String | '取消' | 取消按钮文本 |
| loading | Boolean | false | 加载状态 |

### Events

| 事件 | 参数 | 说明 |
|------|------|------|
| confirm | formData | 确认 |
| cancel | - | 取消 |
| close | - | 关闭 |

---

## 3. ConfirmButton（确认按钮）

### 基础用法

```vue
<template>
  <ConfirmButton
    title="确定要删除这条记录吗？"
    type="danger"
    :loading="loading"
    @confirm="handleDelete"
  >
    删除
  </ConfirmButton>
</template>

<script setup>
import { ref } from 'vue'
import ConfirmButton from '@/components/common/ConfirmButton.vue'

const loading = ref(false)

const handleDelete = async () => {
  loading.value = true
  // API 调用
  loading.value = false
}
</script>
```

### Props

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| title | String | '确定要执行此操作吗？' | 提示标题 |
| confirmText | String | '确定' | 确认按钮文本 |
| cancelText | String | '取消' | 取消按钮文本 |
| type | String | 'default' | 按钮类型 |
| size | String | 'default' | 按钮尺寸 |
| loading | Boolean | false | 加载状态 |
| disabled | Boolean | false | 禁用状态 |

### Events

| 事件 | 参数 | 说明 |
|------|------|------|
| confirm | - | 确认 |
| cancel | - | 取消 |

---

## 4. LoadingState（加载状态）

### 基础用法

```vue
<template>
  <!-- 默认加载 -->
  <LoadingState text="加载中..." />

  <!-- 圆形加载 -->
  <LoadingState type="circle" text="请稍候..." />

  <!-- 点状加载 -->
  <LoadingState type="dots" text="处理中..." />

  <!-- 全屏加载 -->
  <LoadingState fullscreen background text="正在加载数据..." />
</template>

<script setup>
import LoadingState from '@/components/common/LoadingState.vue'
</script>
```

### Props

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| type | String | 'default' | 加载类型（default/circle/dots）|
| text | String | '' | 加载文本 |
| fullscreen | Boolean | false | 全屏显示 |
| background | Boolean | false | 显示背景 |

---

## 5. EmptyState（空状态）

### 基础用法

```vue
<template>
  <!-- 默认空状态 -->
  <EmptyState description="暂无数据" />

  <!-- 自定义图标 -->
  <EmptyState :icon="Document" description="没有找到相关文档" />

  <!-- 自定义图片 -->
  <EmptyState image="/assets/empty.png" description="暂无内容" />

  <!-- 带操作按钮 -->
  <EmptyState
    description="暂无数据"
    show-action
    action-text="刷新"
    @action="handleRefresh"
  />

  <!-- 小尺寸 -->
  <EmptyState small description="无数据" />
</template>

<script setup>
import { Document } from '@element-plus/icons-vue'
import EmptyState from '@/components/common/EmptyState.vue'

const handleRefresh = () => {
  // 刷新逻辑
}
</script>
```

### Props

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| icon | Object | - | 图标组件 |
| image | String | '' | 图片地址 |
| iconSize | Number | 80 | 图标大小 |
| description | String | '暂无数据' | 描述文本 |
| showAction | Boolean | false | 显示操作按钮 |
| actionText | String | '点击刷新' | 按钮文本 |
| actionType | String | 'primary' | 按钮类型 |
| small | Boolean | false | 小尺寸 |

### Events

| 事件 | 参数 | 说明 |
|------|------|------|
| action | - | 操作按钮点击 |

---

## 完整示例：带所有组件的页面

```vue
<template>
  <div class="page">
    <!-- 工具栏 -->
    <div class="toolbar">
      <el-button type="primary" @click="handleAdd">新增</el-button>
    </div>

    <!-- 数据表格 -->
    <DataTable
      v-if="!loading && tableData.length > 0"
      :data="tableData"
      :columns="columns"
      :loading="tableLoading"
      :total="total"
      :page="page"
      :limit="limit"
      show-index
      @refresh="fetchData"
    >
      <template #status="{ row }">
        <el-tag :type="row.status === 1 ? 'success' : 'danger'">
          {{ row.status === 1 ? '启用' : '禁用' }}
        </el-tag>
      </template>

      <template #actions="{ row }">
        <el-button size="small" @click="handleEdit(row)">编辑</el-button>
        <ConfirmButton
          title="确定要删除这条记录吗？"
          type="danger"
          size="small"
          text
          @confirm="handleDelete(row)"
        >
          删除
        </ConfirmButton>
      </template>
    </DataTable>

    <!-- 加载状态 -->
    <LoadingState v-else-if="loading" text="加载中..." />

    <!-- 空状态 -->
    <EmptyState
      v-else
      description="暂无数据"
      show-action
      action-text="刷新"
      @action="fetchData"
    />

    <!-- 表单对话框 -->
    <FormDialog
      v-model="dialogVisible"
      :title="dialogTitle"
      :form-data="formData"
      :rules="rules"
      :loading="formLoading"
      @confirm="handleConfirm"
    >
      <template #default="{ form }">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="请输入名称" />
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-radio-group v-model="form.status">
            <el-radio :value="1">启用</el-radio>
            <el-radio :value="0">禁用</el-radio>
          </el-radio-group>
        </el-form-item>
      </template>
    </FormDialog>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import DataTable from '@/components/common/DataTable.vue'
import FormDialog from '@/components/common/FormDialog.vue'
import ConfirmButton from '@/components/common/ConfirmButton.vue'
import LoadingState from '@/components/common/LoadingState.vue'
import EmptyState from '@/components/common/EmptyState.vue'

// 数据
const loading = ref(true)
const tableLoading = ref(false)
const tableData = ref([])
const total = ref(0)
const page = ref(1)
const limit = ref(20)

// 表格列配置
const columns = [
  { prop: 'id', label: 'ID', width: 80 },
  { prop: 'name', label: '名称', minWidth: 150 },
  { prop: 'status', label: '状态', width: 100, slot: 'status' },
  { prop: 'createTime', label: '创建时间', width: 180 }
]

// 对话框
const dialogVisible = ref(false)
const dialogTitle = ref('新增')
const formLoading = ref(false)
const formData = ref({
  name: '',
  status: 1
})

const rules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }]
}

// 方法
const fetchData = async () => {
  loading.value = true
  tableLoading.value = true
  // API 调用
  setTimeout(() => {
    tableData.value = [
      { id: 1, name: '示例1', status: 1, createTime: '2024-01-01 12:00:00' },
      { id: 2, name: '示例2', status: 0, createTime: '2024-01-02 12:00:00' }
    ]
    total.value = 2
    loading.value = false
    tableLoading.value = false
  }, 1000)
}

const handleAdd = () => {
  dialogTitle.value = '新增'
  formData.value = { name: '', status: 1 }
  dialogVisible.value = true
}

const handleEdit = (row) => {
  dialogTitle.value = '编辑'
  formData.value = { ...row }
  dialogVisible.value = true
}

const handleDelete = async (row) => {
  // API 调用
  await fetchData()
}

const handleConfirm = async (data) => {
  formLoading.value = true
  // API 调用
  setTimeout(() => {
    formLoading.value = false
    dialogVisible.value = false
    fetchData()
  }, 1000)
}

// 初始化
fetchData()
</script>

<style scoped>
.page {
  padding: var(--spacing-lg);
}

.toolbar {
  margin-bottom: var(--spacing-md);
}
</style>
```

---

## 最佳实践

### 1. 统一使用共享组件

所有页面应该使用这些共享组件，保持 UI 一致性。

### 2. 避免重复封装

如果共享组件已经满足需求，不要再封装一层。

### 3. 扩展而非修改

如果需要新功能，优先考虑通过 props/slots 扩展，而不是修改组件源码。

### 4. 保持简单

组件应该简单易用，不要添加过多配置项。

---

## 组件导出

在 `src/components/common/index.js` 统一导出：

```javascript
export { default as DataTable } from './DataTable.vue'
export { default as FormDialog } from './FormDialog.vue'
export { default as ConfirmButton } from './ConfirmButton.vue'
export { default as LoadingState } from './LoadingState.vue'
export { default as EmptyState } from './EmptyState.vue'
```

使用时可以批量导入：

```javascript
import {
  DataTable,
  FormDialog,
  ConfirmButton,
  LoadingState,
  EmptyState
} from '@/components/common'
```

---

**组件库创建完成！** 🎉
