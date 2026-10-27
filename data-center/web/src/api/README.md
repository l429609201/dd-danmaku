# API 封装使用指南

## 概述

本项目采用模块化的 API 封装方式，基于 Axios 进行统一的请求/响应处理。

---

## 目录结构

```
src/
├── utils/
│   └── request.js          # Axios 封装（拦截器、错误处理）
└── api/
    ├── index.js            # 统一导出
    ├── auth.js             # 认证 API
    ├── user.js             # 用户管理 API
    ├── anime.js            # 番剧/剧集 API
    ├── cache.js            # 缓存管理 API
    ├── worker.js           # Worker Bridge API
    └── system.js           # 系统配置 API
```

---

## request.js 封装

### 核心功能

1. **自动 Loading** - 请求时显示全局 loading
2. **Token 注入** - 自动从 localStorage 读取并添加到请求头
3. **错误处理** - 统一处理 HTTP 错误码
4. **401 跳转** - 未授权时自动清除 token 并跳转登录
5. **错误提示** - 自动使用 ElMessage 显示错误信息

### 基础用法

```javascript
import request from '@/utils/request'

// 直接使用 request 实例
request.get('/api/v2/users')
request.post('/api/v2/users', { username: 'test' })
```

### 便捷方法

```javascript
import { get, post, put, del } from '@/utils/request'

// GET 请求
get('/users', { page: 1, limit: 20 })

// POST 请求
post('/users', { username: 'test', password: '123456' })

// PUT 请求
put('/users/1', { username: 'updated' })

// DELETE 请求
del('/users/1')
```

### 禁用 Loading

```javascript
import { requestWithoutLoading } from '@/utils/request'

// 不显示 loading
requestWithoutLoading({
  method: 'get',
  url: '/users'
})
```

### 禁用错误提示

```javascript
import { requestWithoutError } from '@/utils/request'

// 不显示错误提示（自己处理错误）
requestWithoutError({
  method: 'get',
  url: '/users'
}).catch(error => {
  // 自定义错误处理
  console.error(error)
})
```

---

## API 模块使用

### 1. 认证 API（auth.js）

```javascript
import { login, logout, getUserInfo } from '@/api/auth'

// 登录
const handleLogin = async () => {
  try {
    const { token, user } = await login('admin', 'password')
    localStorage.setItem('token', token)
    localStorage.setItem('user', JSON.stringify(user))
    // 跳转到首页
  } catch (error) {
    // 错误已自动提示
  }
}

// 获取用户信息
const fetchUserInfo = async () => {
  const user = await getUserInfo()
  console.log(user)
}

// 登出
const handleLogout = async () => {
  await logout()
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  // 跳转到登录页
}
```

### 2. 用户管理 API（user.js）

```javascript
import { getUserList, createUser, updateUser, deleteUser } from '@/api/user'

// 获取用户列表
const fetchUsers = async () => {
  const { total, list } = await getUserList({
    page: 1,
    limit: 20,
    keyword: 'admin'
  })
  console.log('总数:', total)
  console.log('列表:', list)
}

// 创建用户
const handleCreateUser = async () => {
  await createUser({
    username: 'newuser',
    password: '123456',
    role: 'user'
  })
  // 刷新列表
}

// 更新用户
const handleUpdateUser = async (id) => {
  await updateUser(id, {
    username: 'updated_name'
  })
  // 刷新列表
}

// 删除用户
const handleDeleteUser = async (id) => {
  await deleteUser(id)
  // 刷新列表
}
```

### 3. 番剧管理 API（anime.js）

```javascript
import {
  getAnimeList,
  searchAnime,
  matchVideo,
  getComments
} from '@/api/anime'

// 获取番剧列表
const fetchAnimeList = async () => {
  const { total, list } = await getAnimeList({
    page: 1,
    limit: 20,
    keyword: '进击的巨人'
  })
}

// 搜索番剧
const handleSearch = async (query) => {
  const results = await searchAnime(query, 10)
  console.log('搜索结果:', results)
}

// 视频匹配
const handleMatchVideo = async () => {
  const { success, matches } = await matchVideo({
    fileName: '[字幕组] 番剧名 第01集.mp4',
    fileHash: 'abc123',
    fileSize: 500000000
  })
  
  if (success && matches.length > 0) {
    console.log('匹配到:', matches[0])
  }
}

// 获取弹幕
const fetchComments = async (episodeId) => {
  const { count, comments } = await getComments(episodeId)
  console.log(`共 ${count} 条弹幕`)
}
```

### 4. 缓存管理 API（cache.js）

```javascript
import {
  getCacheList,
  deleteCache,
  clearAllCache,
  getCacheStats
} from '@/api/cache'

// 获取缓存列表
const fetchCacheList = async () => {
  const { total, list } = await getCacheList({
    page: 1,
    limit: 50,
    keyword: 'dandanplay'
  })
}

// 删除单个缓存
const handleDeleteCache = async (key) => {
  await deleteCache(key)
  ElMessage.success('删除成功')
}

// 清空所有缓存
const handleClearAll = async () => {
  const { deleted } = await clearAllCache()
  ElMessage.success(`已清空 ${deleted} 条缓存`)
}

// 获取统计信息
const fetchStats = async () => {
  const stats = await getCacheStats()
  console.log('缓存统计:', stats)
}
```

### 5. Worker 管理 API（worker.js）

```javascript
import {
  getNodeList,
  getNodeStats,
  sendMessage,
  getEventList
} from '@/api/worker'

// 获取节点列表
const fetchNodes = async () => {
  const { total, list } = await getNodeList({
    page: 1,
    limit: 20,
    status: 'online'
  })
}

// 获取统计信息
const fetchNodeStats = async () => {
  const { total, online, offline } = await getNodeStats()
  console.log(`总节点: ${total}, 在线: ${online}, 离线: ${offline}`)
}

// 发送控制消息
const handleSendMessage = async (nodeId) => {
  await sendMessage({
    targetNodeId: nodeId,
    messageType: 'RESTART',
    payload: { reason: '手动重启' }
  })
}

// 获取事件日志
const fetchEvents = async () => {
  const { total, list } = await getEventList({
    page: 1,
    limit: 50,
    eventType: 'NODE_CONNECTED'
  })
}
```

### 6. 系统管理 API（system.js）

```javascript
import {
  healthCheck,
  getSystemInfo,
  getDatabaseStats,
  cleanupExpiredData
} from '@/api/system'

// 健康检查
const checkHealth = async () => {
  const { status, version, uptime } = await healthCheck()
  console.log(`状态: ${status}, 版本: ${version}`)
}

// 获取系统信息
const fetchSystemInfo = async () => {
  const info = await getSystemInfo()
  console.log('系统信息:', info)
}

// 数据库统计
const fetchDbStats = async () => {
  const stats = await getDatabaseStats()
  console.log('数据库统计:', stats)
}

// 清理过期数据
const handleCleanup = async () => {
  const { deleted } = await cleanupExpiredData({
    days: 30,
    tables: ['api_response_cache', 'runtime_event']
  })
  ElMessage.success(`已清理 ${deleted} 条数据`)
}
```

---

## 在 Vue 组件中使用

### 基础示例

```vue
<template>
  <div>
    <DataTable
      :data="users"
      :columns="columns"
      :loading="loading"
      :total="total"
      @refresh="fetchUsers"
    />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getUserList } from '@/api/user'
import DataTable from '@/components/common/DataTable.vue'

const users = ref([])
const loading = ref(false)
const total = ref(0)

const columns = [
  { prop: 'id', label: 'ID', width: 80 },
  { prop: 'username', label: '用户名', minWidth: 150 },
  { prop: 'role', label: '角色', width: 100 }
]

const fetchUsers = async () => {
  loading.value = true
  try {
    const res = await getUserList({ page: 1, limit: 20 })
    users.value = res.list
    total.value = res.total
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchUsers()
})
</script>
```

### 使用 ConfirmButton 删除

```vue
<template>
  <ConfirmButton
    title="确定要删除这个用户吗？"
    type="danger"
    @confirm="handleDelete(row.id)"
  >
    删除
  </ConfirmButton>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { deleteUser } from '@/api/user'
import ConfirmButton from '@/components/common/ConfirmButton.vue'

const props = defineProps({
  row: Object
})

const emit = defineEmits(['refresh'])

const handleDelete = async (id) => {
  await deleteUser(id)
  ElMessage.success('删除成功')
  emit('refresh')
}
</script>
```

### 表单提交

```vue
<template>
  <FormDialog
    v-model="dialogVisible"
    title="新增用户"
    :form-data="formData"
    :rules="rules"
    :loading="loading"
    @confirm="handleSubmit"
  >
    <template #default="{ form }">
      <el-form-item label="用户名" prop="username">
        <el-input v-model="form.username" />
      </el-form-item>
      <el-form-item label="密码" prop="password">
        <el-input v-model="form.password" type="password" />
      </el-form-item>
    </template>
  </FormDialog>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { createUser } from '@/api/user'
import FormDialog from '@/components/common/FormDialog.vue'

const dialogVisible = ref(false)
const loading = ref(false)

const formData = ref({
  username: '',
  password: ''
})

const rules = {
  username: [{ required: true, message: '请输入用户名' }],
  password: [{ required: true, message: '请输入密码' }]
}

const emit = defineEmits(['refresh'])

const handleSubmit = async (data) => {
  loading.value = true
  try {
    await createUser(data)
    ElMessage.success('创建成功')
    dialogVisible.value = false
    emit('refresh')
  } finally {
    loading.value = false
  }
}
</script>
```

---

## 错误处理

### 自动错误处理

默认情况下，所有错误会自动显示 ElMessage 提示：

```javascript
// 会自动显示错误提示
await getUserList({ page: 1 })
```

### 自定义错误处理

```javascript
try {
  await getUserList({ page: 1 })
} catch (error) {
  // 自动错误提示已显示
  // 这里可以做额外处理
  console.error('获取用户列表失败:', error)
}
```

### 禁用自动错误提示

```javascript
import { requestWithoutError } from '@/utils/request'

requestWithoutError({
  method: 'get',
  url: '/api/v2/users'
}).catch(error => {
  // 自己处理错误
  if (error.response?.status === 404) {
    ElMessage.warning('用户不存在')
  }
})
```

---

## 最佳实践

### 1. 使用 try-finally 确保 loading 状态

```javascript
const loading = ref(false)

const fetchData = async () => {
  loading.value = true
  try {
    const data = await getDataList()
    // 处理数据
  } finally {
    loading.value = false // 确保 loading 被关闭
  }
}
```

### 2. 使用 async/await 而非 Promise.then

```javascript
// ✅ 推荐
const data = await getUserList()

// ❌ 不推荐
getUserList().then(data => {
  // ...
})
```

### 3. 封装 composable 复用逻辑

```javascript
// src/composables/useUserList.js
import { ref } from 'vue'
import { getUserList } from '@/api/user'

export function useUserList() {
  const users = ref([])
  const loading = ref(false)
  const total = ref(0)

  const fetchUsers = async (params) => {
    loading.value = true
    try {
      const res = await getUserList(params)
      users.value = res.list
      total.value = res.total
    } finally {
      loading.value = false
    }
  }

  return {
    users,
    loading,
    total,
    fetchUsers
  }
}
```

使用：

```vue
<script setup>
import { useUserList } from '@/composables/useUserList'

const { users, loading, total, fetchUsers } = useUserList()

onMounted(() => {
  fetchUsers({ page: 1, limit: 20 })
})
</script>
```

---

## 总结

**API 封装优势**：
1. ✅ **统一错误处理** - 减少重复代码
2. ✅ **自动 Loading** - 提升用户体验
3. ✅ **Token 管理** - 自动注入和刷新
4. ✅ **模块化** - 按业务领域组织
5. ✅ **类型注释** - JSDoc 提供智能提示
6. ✅ **易于维护** - API 变更只需修改一处

**使用建议**：
- 优先使用封装好的 API 方法
- 复杂逻辑封装成 composable
- 使用 try-finally 管理 loading 状态
- 善用 ConfirmButton/FormDialog 简化交互
