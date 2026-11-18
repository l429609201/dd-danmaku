<template>
  <div class="page">
    <div class="page-header">
      <h1 class="page-title">数据迁移</h1>
      <el-button size="small" @click="loadStatus">刷新状态</el-button>
    </div>

    <!-- 迁移说明 -->
    <el-alert type="info" :closable="false" style="margin-bottom:16px">
      <template #title>
        将旧版 MySQL 数据库数据迁移至当前数据库（MySQL / PostgreSQL）。迁移前请确保目标数据库已初始化（<code>ensure_schema</code>）。
      </template>
    </el-alert>

    <!-- 当前状态 -->
    <div class="panel">
      <div class="section-title">迁移状态</div>
      <div v-if="statusLoading" class="loading">加载中…</div>
      <template v-else>
        <div v-if="!latestRun" class="empty">尚未执行过迁移</div>
        <table v-else class="data-table">
          <tbody>
            <tr><td>运行 ID</td><td><code>{{ latestRun.run_id }}</code></td></tr>
            <tr><td>状态</td><td><el-tag :type="statusTagType(latestRun.status)" size="small">{{ latestRun.status }}</el-tag></td></tr>
            <tr><td>模式</td><td>{{ latestRun.mode }}</td></tr>
            <tr><td>来源库</td><td><code>{{ latestRun.source_identity_hash }}</code></td></tr>
            <tr><td>目标库</td><td><code>{{ latestRun.target_identity_hash }}</code></td></tr>
            <tr><td>开始时间</td><td>{{ fmtTime(latestRun.started_at) }}</td></tr>
            <tr v-if="latestRun.finished_at"><td>结束时间</td><td>{{ fmtTime(latestRun.finished_at) }}</td></tr>
            <tr><td>表进度</td><td>{{ latestRun.tables_done }} / {{ latestRun.tables_total }}（失败 {{ latestRun.tables_failed }}）</td></tr>
          </tbody>
        </table>

        <!-- 进行中时显示取消按钮 -->
        <div v-if="hasActive" class="action-row" style="margin-top:12px">
          <el-button type="danger" size="small" :loading="cancelLoading" @click="cancelMigration">取消迁移</el-button>
          <el-button size="small" @click="loadTableProgress(latestRun.run_id)">查看表进度</el-button>
        </div>
        <!-- 完成后也可查看表进度 -->
        <div v-else-if="latestRun" class="action-row" style="margin-top:12px">
          <el-button size="small" @click="loadTableProgress(latestRun.run_id)">查看表进度</el-button>
        </div>
      </template>
    </div>

    <!-- 表级进度 -->
    <div v-if="tableProgress.length > 0" class="panel" style="margin-top:16px">
      <div class="section-title">表迁移进度（<code>{{ progressRunId }}</code>）</div>
      <el-table :data="tableProgress" stripe size="small" style="width:100%">
        <el-table-column prop="source_table" label="源表" />
        <el-table-column prop="target_table" label="目标表" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="已读行数" width="100">
          <template #default="{ row }">{{ fmt(row.rows_read) }}</template>
        </el-table-column>
        <el-table-column label="已写行数" width="100">
          <template #default="{ row }">{{ fmt(row.rows_written) }}</template>
        </el-table-column>
        <el-table-column prop="error_kind" label="错误类型" show-overflow-tooltip />
      </el-table>
    </div>

    <!-- 历史运行记录 -->
    <div v-if="runHistory.length > 1" class="panel" style="margin-top:16px">
      <div class="section-title">历史迁移记录</div>
      <el-table :data="runHistory" stripe size="small" style="width:100%">
        <el-table-column prop="run_id" label="运行 ID" show-overflow-tooltip />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="开始时间" width="160">
          <template #default="{ row }">{{ fmtTime(row.started_at) }}</template>
        </el-table-column>
        <el-table-column label="进度">
          <template #default="{ row }">{{ row.tables_done }}/{{ row.tables_total }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button link size="small" @click="loadTableProgress(row.run_id)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 启动迁移表单 -->
    <div class="panel" style="margin-top:16px">
      <div class="section-title">启动新迁移</div>
      <el-alert v-if="hasActive" type="warning" :closable="false" style="margin-bottom:12px">
        当前有活跃的迁移任务，请等待完成或取消后再启动新迁移。
      </el-alert>

      <!-- 配置预设管理 -->
      <div class="preset-bar">
        <el-select
          v-model="selectedPreset"
          placeholder="选择已保存的配置"
          clearable
          style="width:240px"
          @change="loadPreset"
        >
          <el-option
            v-for="p in presets"
            :key="p.name"
            :label="p.name"
            :value="p.name"
          />
        </el-select>
        <el-button size="small" @click="showSavePresetDialog">保存当前配置</el-button>
        <el-button
          v-if="selectedPreset"
          size="small"
          type="danger"
          @click="deletePreset"
        >删除选中配置</el-button>
      </div>

      <el-form :model="form" label-width="140px" :disabled="hasActive || startLoading" style="margin-top:16px">
        <el-form-item label="主机地址">
          <el-input v-model="form.host" placeholder="例：192.168.10.220" style="max-width:300px" />
        </el-form-item>

        <el-form-item label="端口">
          <el-input-number v-model="form.port" :min="1" :max="65535" style="width:140px" />
        </el-form-item>

        <el-form-item label="用户名">
          <el-input v-model="form.username" placeholder="例：root" style="max-width:240px" />
        </el-form-item>

        <el-form-item label="密码">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            placeholder="数据库密码"
            style="max-width:300px"
          />
          <div class="form-hint">密码不会被记录到日志。</div>
        </el-form-item>

        <el-form-item label="数据库名">
          <el-input v-model="form.database" placeholder="例：worker" style="max-width:240px" />
        </el-form-item>

        <el-divider content-position="left">
          <span style="font-size:13px;color:var(--el-text-color-secondary)">目标数据库（可选）</span>
        </el-divider>
        <div class="form-hint" style="margin:-8px 0 12px 140px">
          留空则使用服务器自身的数据库环境变量。<strong>仅支持 MySQL 或 PostgreSQL。</strong>
        </div>

        <el-form-item label="目标协议">
          <el-radio-group v-model="form.targetType">
            <el-radio value="mysql">MySQL</el-radio>
            <el-radio value="postgres">PostgreSQL</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="目标主机地址">
          <el-input v-model="form.targetHost" placeholder="留空使用服务器默认" style="max-width:300px" />
        </el-form-item>

        <el-form-item label="目标端口">
          <el-input-number v-model="form.targetPort" :min="1" :max="65535" style="width:140px" />
        </el-form-item>

        <el-form-item label="目标用户名">
          <el-input v-model="form.targetUsername" placeholder="留空使用服务器默认" style="max-width:240px" />
        </el-form-item>

        <el-form-item label="目标密码">
          <el-input
            v-model="form.targetPassword"
            type="password"
            show-password
            placeholder="留空使用服务器默认"
            style="max-width:300px"
          />
        </el-form-item>

        <el-form-item label="目标数据库名">
          <el-input v-model="form.targetDatabase" placeholder="留空使用服务器默认" style="max-width:240px" />
        </el-form-item>

        <el-form-item label="迁移模式">
          <el-radio-group v-model="form.mode">
            <el-radio value="dry_run">预演（dry_run）— 仅检查，不写入数据</el-radio>
            <el-radio value="apply">执行（apply）— 实际复制数据</el-radio>
          </el-radio-group>
          <div class="form-hint">建议先执行预演，确认无误后再执行实际迁移。</div>
        </el-form-item>

        <el-form-item label="批次大小">
          <el-input-number v-model="form.batch_size" :min="10" :max="5000" :step="100" style="width:160px" />
          <div class="form-hint">每批复制的行数，默认 500。</div>
        </el-form-item>

        <el-form-item label="迁移表（逗号分隔）">
          <el-input
            v-model="form.tables_input"
            placeholder="例：animes,episodes,anime_aliases"
            style="max-width:500px"
          />
          <div class="form-hint"><strong>留空则迁移全部源表。</strong>每个表名只能含字母、数字和下划线。</div>
        </el-form-item>

        <el-form-item label="运行 ID（可选）">
          <el-input v-model="form.run_id" placeholder="自动生成" style="max-width:280px" />
          <div class="form-hint">自定义运行标识（字母、数字、连字符、下划线）。</div>
        </el-form-item>

        <el-form-item>
          <el-button
            type="primary"
            :loading="startLoading"
            :disabled="!canStart"
            @click="startMigration"
          >
            {{ form.mode === 'dry_run' ? '开始预演' : '开始迁移' }}
          </el-button>
        </el-form-item>
      </el-form>

      <!-- 启动结果 -->
      <div v-if="startResult" class="start-result">
        <el-alert :type="startResult.success ? 'success' : 'error'" :closable="false">
          <template #title>{{ startResult.message }}</template>
          <template v-if="startResult.detail" #default>
            <div class="result-detail">{{ startResult.detail }}</div>
          </template>
        </el-alert>
      </div>
    </div>

    <!-- 保存配置对话框 -->
    <el-dialog v-model="savePresetVisible" title="保存迁移配置" width="400px">
      <el-form label-width="80px">
        <el-form-item label="配置名称">
          <el-input v-model="presetName" placeholder="例：旧版生产库" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="savePresetVisible = false">取消</el-button>
        <el-button type="primary" @click="savePreset">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiV2 } from '@/utils/api'

// ===== 状态 =====
const statusLoading = ref(false)
const hasActive = ref(false)
const latestRun = ref(null)
const runHistory = ref([])
const tableProgress = ref([])
const progressRunId = ref('')

// ===== 取消 =====
const cancelLoading = ref(false)

// ===== 启动 =====
const startLoading = ref(false)
const startResult = ref(null)
const form = ref({
  // ===== 源数据库 =====
  host: '',
  port: 3306,
  username: '',
  password: '',
  database: '',
  // ===== 目标数据库（可选）=====
  // 若留空，服务器将使用自身的 DATABASE_URL 环境变量（需 MySQL 或 PostgreSQL）
  targetType: 'mysql',    // 目标协议：mysql | postgres
  targetHost: '',
  targetPort: 3306,
  targetUsername: '',
  targetPassword: '',
  targetDatabase: '',
  // ===== 迁移选项 =====
  mode: 'dry_run',
  batch_size: 500,
  tables_input: '',
  run_id: '',
})

const canStart = computed(() => {
  if (hasActive.value) return false
  if (!form.value.host || !form.value.username || !form.value.database) return false
  // 如果目标库填写了任意字段，则要求主机、用户名、数据库名都填写
  const hasAnyTarget = form.value.targetHost || form.value.targetUsername || form.value.targetDatabase || form.value.targetPassword
  if (hasAnyTarget && (!form.value.targetHost || !form.value.targetUsername || !form.value.targetDatabase)) return false
  return true
})

// ===== 配置预设 =====
const PRESETS_KEY = 'dd_migration_presets'
const presets = ref([])
const selectedPreset = ref('')
const savePresetVisible = ref(false)
const presetName = ref('')

function loadPresets() {
  try {
    const stored = localStorage.getItem(PRESETS_KEY)
    presets.value = stored ? JSON.parse(stored) : []
  } catch {
    presets.value = []
  }
}

function showSavePresetDialog() {
  presetName.value = ''
  savePresetVisible.value = true
}

function savePreset() {
  if (!presetName.value.trim()) {
    ElMessage.warning('请输入配置名称')
    return
  }
  const preset = {
    name: presetName.value.trim(),
    // 源数据库
    host: form.value.host,
    port: form.value.port,
    username: form.value.username,
    password: btoa(form.value.password), // 简单 Base64 编码（非加密，仅混淆）
    database: form.value.database,
    // 目标数据库（可选）
    targetType: form.value.targetType,
    targetHost: form.value.targetHost,
    targetPort: form.value.targetPort,
    targetUsername: form.value.targetUsername,
    targetPassword: btoa(form.value.targetPassword),
    targetDatabase: form.value.targetDatabase,
    // 迁移选项
    batch_size: form.value.batch_size,
  }
  const existing = presets.value.findIndex(p => p.name === preset.name)
  if (existing >= 0) {
    presets.value[existing] = preset
  } else {
    presets.value.push(preset)
  }
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets.value))
  ElMessage.success(`配置"${preset.name}"已保存`)
  savePresetVisible.value = false
  selectedPreset.value = preset.name
}

function loadPreset(name) {
  if (!name) return
  const preset = presets.value.find(p => p.name === name)
  if (!preset) return
  // 源数据库
  form.value.host = preset.host || ''
  form.value.port = preset.port || 3306
  form.value.username = preset.username || ''
  form.value.password = preset.password ? atob(preset.password) : ''
  form.value.database = preset.database || ''
  // 目标数据库（向后兼容：老版本配置可能没有这些字段）
  form.value.targetType = preset.targetType || 'mysql'
  form.value.targetHost = preset.targetHost || ''
  form.value.targetPort = preset.targetPort || 3306
  form.value.targetUsername = preset.targetUsername || ''
  form.value.targetPassword = preset.targetPassword ? atob(preset.targetPassword) : ''
  form.value.targetDatabase = preset.targetDatabase || ''
  // 迁移选项
  form.value.batch_size = preset.batch_size || 500
}

function deletePreset() {
  if (!selectedPreset.value) return
  ElMessageBox.confirm(`确认删除配置"${selectedPreset.value}"？`, '删除确认', {
    type: 'warning',
  }).then(() => {
    presets.value = presets.value.filter(p => p.name !== selectedPreset.value)
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets.value))
    ElMessage.success('已删除')
    selectedPreset.value = ''
  }).catch(() => {})
}

// ===== 加载状态 =====
async function loadStatus() {
  statusLoading.value = true
  try {
    // 加载最新状态
    const status = await apiV2('/migration/status')
    hasActive.value = status.has_active ?? false
    latestRun.value = status.latest_run ?? null

    // 加载历史列表
    const runs = await apiV2('/migration/runs')
    runHistory.value = runs.items ?? runs ?? []
  } catch (e) {
    console.error('迁移状态加载失败', e)
    hasActive.value = false
    latestRun.value = null
  } finally {
    statusLoading.value = false
  }
}

// ===== 加载表进度 =====
async function loadTableProgress(runId) {
  try {
    const res = await apiV2(`/migration/${encodeURIComponent(runId)}/tables`)
    tableProgress.value = res.tables ?? res ?? []
    progressRunId.value = runId
  } catch (e) {
    console.error('表进度加载失败', e)
    ElMessage.error('无法加载表进度：' + (e.message || e))
  }
}

// ===== 取消迁移 =====
async function cancelMigration() {
  cancelLoading.value = true
  try {
    await apiV2('/migration/cancel', { method: 'POST' })
    ElMessage.success('已请求取消迁移')
    await loadStatus()
  } catch (e) {
    ElMessage.error('取消失败：' + (e.message || e))
  } finally {
    cancelLoading.value = false
  }
}

// ===== 启动迁移 =====
async function startMigration() {
  if (!form.value.host || !form.value.username || !form.value.database) {
    ElMessage.warning('请填写完整的数据库连接信息')
    return
  }

  // 拼接数据库 URL
  const source_db_url = `mysql://${form.value.username}:${form.value.password}@${form.value.host}:${form.value.port}/${form.value.database}`

  // 目标库 URL（若用户填写了目标主机则拼接，否则由服务器读取自身环境变量）
  let target_db_url = undefined
  if (form.value.targetHost && form.value.targetUsername && form.value.targetDatabase) {
    target_db_url = `${form.value.targetType}://${form.value.targetUsername}:${form.value.targetPassword}@${form.value.targetHost}:${form.value.targetPort}/${form.value.targetDatabase}`
  }

  startLoading.value = true
  startResult.value = null
  try {
    const tables = form.value.tables_input
      ? form.value.tables_input.split(',').map(t => t.trim()).filter(Boolean)
      : []

    const body = {
      source_db_url,
      mode: form.value.mode,
      batch_size: form.value.batch_size,
      tables,
    }
    // 若用户填写了目标数据库，将 target_db_url 一并发送
    if (target_db_url) body.target_db_url = target_db_url
    if (form.value.run_id) body.run_id = form.value.run_id

    const res = await apiV2('/migration/start', {
      method: 'POST',
      body,
    })

    startResult.value = {
      success: true,
      message: form.value.mode === 'dry_run'
        ? `预演已启动：发现 ${res.source_tables_found ?? 0} 张源表`
        : `迁移已在后台启动，共 ${res.source_tables_found ?? 0} 张源表`,
      detail: res.selected_tables ? `将迁移：${res.selected_tables.join(', ')}` : null,
    }
    // 刷新状态
    await loadStatus()
  } catch (e) {
    startResult.value = {
      success: false,
      message: '启动失败',
      detail: e.message || String(e),
    }
  } finally {
    startLoading.value = false
  }
}

// ===== 格式化 =====
function fmtTime(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

function fmt(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN')
}

function statusTagType(status) {
  const s = (status || '').toLowerCase()
  if (s === 'completed') return 'success'
  if (s === 'failed') return 'danger'
  if (s === 'cancelled') return 'warning'
  if (s === 'started' || s === 'inprogress' || s === 'in_progress') return 'primary'
  return 'info'
}

onMounted(() => {
  loadPresets()
  loadStatus()
})
</script>

<style scoped>
.page {
  padding: var(--spacing-lg);
  max-width: 1000px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-md);
}

.page-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}

.panel {
  background: var(--color-bg-overlay);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--spacing-md);
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: var(--spacing-sm);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.data-table td {
  padding: 5px 8px 5px 0;
  color: var(--color-text);
  border-bottom: 1px solid var(--color-border-light, var(--color-border));
  vertical-align: top;
}

.data-table td:first-child {
  color: var(--color-text-secondary);
  width: 150px;
  flex-shrink: 0;
}

.data-table tr:last-child td {
  border-bottom: none;
}

.action-row {
  display: flex;
  gap: 8px;
}

.preset-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  padding: 12px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.form-hint {
  font-size: 12px;
  color: var(--color-text-placeholder);
  margin-top: 4px;
}

.start-result {
  margin-top: var(--spacing-md);
}

.result-detail {
  font-size: 12px;
  margin-top: 4px;
  word-break: break-all;
}

.loading {
  color: var(--color-text-secondary);
  font-size: 13px;
  padding: var(--spacing-sm);
}

.empty {
  color: var(--color-text-placeholder);
  font-size: 13px;
  text-align: center;
  padding: var(--spacing-md);
}
</style>
