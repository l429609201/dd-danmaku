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
            <tr><td>来源库</td><td><code>{{ latestRun.source_db }}</code></td></tr>
            <tr><td>目标库</td><td><code>{{ latestRun.target_db }}</code></td></tr>
            <tr><td>开始时间</td><td>{{ fmtTime(latestRun.started_at) }}</td></tr>
            <tr v-if="latestRun.completed_at"><td>结束时间</td><td>{{ fmtTime(latestRun.completed_at) }}</td></tr>
            <tr><td>表进度</td><td>{{ latestRun.tables_done }} / {{ latestRun.tables_total }}（失败 {{ latestRun.tables_failed }}）</td></tr>
            <tr v-if="latestRun.error_message"><td>错误信息</td><td class="error-cell">{{ latestRun.error_message }}</td></tr>
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
        <el-table-column prop="mode" label="模式" width="80" />
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
      <el-form :model="form" label-width="140px" :disabled="hasActive || startLoading">
        <el-form-item label="旧版数据库 URL">
          <el-input
            v-model="form.source_db_url"
            placeholder="mysql://user:pass@host:3306/dbname"
            type="password"
            show-password
            style="max-width:500px"
          />
          <div class="form-hint">仅支持 MySQL（mysql://）作为来源库。密码不会被记录到日志。</div>
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
            placeholder="例：animes,episodes,anime_aliases（留空则迁移全部）"
            style="max-width:500px"
          />
          <div class="form-hint">留空默认迁移全部旧版表。每个表名只能含字母、数字和下划线。</div>
        </el-form-item>

        <el-form-item label="运行 ID（可选）">
          <el-input v-model="form.run_id" placeholder="自动生成" style="max-width:280px" />
          <div class="form-hint">自定义运行标识（字母、数字、连字符、下划线）。</div>
        </el-form-item>

        <el-form-item>
          <el-button
            type="primary"
            :loading="startLoading"
            :disabled="!form.source_db_url || hasActive"
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
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
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
  source_db_url: '',
  mode: 'dry_run',
  batch_size: 500,
  tables_input: '',
  run_id: '',
})

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
  if (!form.value.source_db_url) {
    ElMessage.warning('请填写旧版数据库 URL')
    return
  }

  startLoading.value = true
  startResult.value = null
  try {
    const tables = form.value.tables_input
      ? form.value.tables_input.split(',').map(t => t.trim()).filter(Boolean)
      : []

    const body = {
      source_db_url: form.value.source_db_url,
      mode: form.value.mode,
      batch_size: form.value.batch_size,
      tables,
    }
    if (form.value.run_id) body.run_id = form.value.run_id

    const res = await apiV2('/migration/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    startResult.value = {
      success: true,
      message: form.value.mode === 'dry_run'
        ? `预演已启动：发现 ${res.table_count ?? 0} 张可迁移表`
        : `迁移已在后台启动，共 ${res.table_count ?? 0} 张表`,
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

.error-cell {
  color: var(--color-danger);
  font-size: 12px;
}

.action-row {
  display: flex;
  gap: 8px;
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
