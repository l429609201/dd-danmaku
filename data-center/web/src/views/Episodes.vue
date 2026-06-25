<template>
  <div class="app-page">
    <h1 class="app-page__title">集数链接</h1>

    <!-- 统计概览 -->
    <el-row :gutter="12" class="stat-row" v-if="stats">
      <el-col :span="6">
        <el-card shadow="never" class="stat-card">
          <div class="stat-label">链接总数</div>
          <div class="stat-value">{{ stats.total }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="stat-card is-accent">
          <div class="stat-label">人工修正</div>
          <div class="stat-value">{{ stats.manual }}</div>
          <div class="stat-sub">已人工核对</div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="never" class="stat-card">
          <div class="stat-label">匹配来源分布</div>
          <div class="src-tags">
            <el-tag v-for="(cnt, src) in stats.sources" :key="src" size="small" class="src-tag">
              {{ src }} · {{ cnt }}
            </el-tag>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <div class="app-toolbar">
      <el-input v-model="keyword" placeholder="标题关键词" clearable style="width: 200px" @keyup.enter="reload" />
      <el-input v-model="episodeId" placeholder="episodeId" clearable style="width: 160px" @keyup.enter="reload" />
      <el-select v-model="matchSource" placeholder="匹配来源" clearable style="width: 150px" @change="reload">
        <el-option v-for="s in sourceOptions" :key="s" :label="s" :value="s" />
      </el-select>
      <el-button type="primary" :icon="Search" @click="reload">查询</el-button>
      <el-button :icon="Plus" @click="openCreate">手动创建</el-button>
    </div>

    <el-card shadow="never">
      <el-table :data="items" size="small" v-loading="loading" empty-text="暂无集数链接">
        <el-table-column prop="local_title" label="标题" show-overflow-tooltip min-width="160" />
        <el-table-column label="季" width="56">
          <template #default="{ row }">{{ row.season_number ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="集" width="56">
          <template #default="{ row }">{{ row.episode_number || '—' }}</template>
        </el-table-column>
        <el-table-column prop="episode_title" label="分集标题" show-overflow-tooltip min-width="130">
          <template #default="{ row }">{{ row.episode_title || '—' }}</template>
        </el-table-column>
        <el-table-column prop="dandan_episode_id" label="episodeId" width="110" />
        <el-table-column prop="anime_title" label="动画" show-overflow-tooltip min-width="130">
          <template #default="{ row }">{{ row.anime_title || '—' }}</template>
        </el-table-column>
        <el-table-column prop="match_source" label="来源" width="120" />
        <el-table-column label="置信度" width="100">
          <template #default="{ row }">
            <el-tag :type="confType(row.confidence)" size="small">{{ row.confidence }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="人工" width="60">
          <template #default="{ row }">
            <el-tag v-if="row.is_manual" type="success" size="small">是</el-tag>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="最近使用" width="160">
          <template #default="{ row }">{{ fmt(row.last_used_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openFix(row)">修正</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="app-pager">
        <el-pagination layout="prev, pager, next, jumper, total" :total="total"
                       :page-size="pageSize" :current-page="page" @current-change="onPage" />
      </div>
    </el-card>

    <!-- 修正弹窗 -->
    <el-dialog v-model="fixVisible" title="人工修正集数链接" width="460px">
      <el-form label-width="90px" v-if="form">
        <el-form-item label="标题">{{ form.local_title }}</el-form-item>
        <el-form-item label="episodeId">
          <el-input v-model="form.dandan_episode_id" />
        </el-form-item>
        <el-form-item label="分集标题">
          <el-input v-model="form.episode_title" />
        </el-form-item>
        <el-form-item label="置信度">
          <el-input-number v-model="form.confidence" :min="0" :max="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="fixVisible = false">取消</el-button>
        <el-button type="primary" @click="saveFix">保存</el-button>
      </template>
    </el-dialog>

    <!-- 手动创建弹窗 -->
    <el-dialog v-model="createVisible" title="手动创建集数链接" width="460px">
      <el-form label-width="100px">
        <el-form-item label="本地标题" required>
          <el-input v-model="createForm.local_title" placeholder="必填" />
        </el-form-item>
        <el-form-item label="episodeId" required>
          <el-input v-model="createForm.dandan_episode_id" placeholder="必填，dandanplay 集数ID" />
        </el-form-item>
        <el-form-item label="分集标题">
          <el-input v-model="createForm.episode_title" />
        </el-form-item>
        <el-form-item label="动画标题">
          <el-input v-model="createForm.anime_title" />
        </el-form-item>
        <el-form-item label="季 / 集">
          <el-input v-model.number="createForm.season_number" placeholder="季" style="width: 48%" />
          <el-input v-model="createForm.episode_number" placeholder="集" style="width: 48%; margin-left: 4%" />
        </el-form-item>
        <el-form-item label="置信度">
          <el-input-number v-model="createForm.confidence" :min="0" :max="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" @click="saveCreate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Plus } from '@element-plus/icons-vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'Episodes',
  setup() {
    const items = ref([])
    const total = ref(0)
    const page = ref(1)
    const pageSize = ref(20)
    const keyword = ref('')
    const episodeId = ref('')
    const matchSource = ref('')
    const stats = ref(null)
    const loading = ref(false)
    // 匹配来源可选项（与后端 match_source 取值对齐）
    const sourceOptions = ['search_anime', 'search_episodes', 'bangumi', 'match', 'manual']

    const fixVisible = ref(false)
    const form = ref(null)
    const createVisible = ref(false)
    const createForm = ref({})

    const loadStats = async () => {
      try { const res = await apiV2('/episodes/links/stats'); stats.value = res.data }
      catch (e) { /* 统计失败不阻塞列表 */ }
    }

    const load = async () => {
      loading.value = true
      try {
        const q = new URLSearchParams({ page: page.value, page_size: pageSize.value })
        if (keyword.value) q.set('keyword', keyword.value)
        if (episodeId.value) q.set('episode_id', episodeId.value)
        if (matchSource.value) q.set('match_source', matchSource.value)
        const res = await apiV2(`/episodes/links?${q.toString()}`)
        items.value = res.items || []
        total.value = res.total || 0
      } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
    }
    const reload = () => { page.value = 1; load(); loadStats() }
    const onPage = (p) => { page.value = p; load() }

    const openFix = (r) => {
      form.value = {
        id: r.id, local_title: r.local_title,
        dandan_episode_id: r.dandan_episode_id,
        episode_title: r.episode_title || '',
        confidence: r.confidence,
      }
      fixVisible.value = true
    }
    const saveFix = async () => {
      try {
        const { id, local_title, ...body } = form.value
        await apiV2(`/episodes/links/${id}`, { method: 'PUT', body })
        ElMessage.success('修正成功'); fixVisible.value = false; load(); loadStats()
      } catch (e) { ElMessage.error(e.message) }
    }

    const openCreate = () => {
      createForm.value = { confidence: 100 }
      createVisible.value = true
    }
    const saveCreate = async () => {
      const f = createForm.value
      if (!f.local_title || !f.dandan_episode_id) { ElMessage.warning('本地标题和 episodeId 为必填'); return }
      try {
        // source_cache_key 后端必填，手动创建用 manual 占位标识
        const body = { ...f, match_source: 'manual', source_cache_key: 'manual:' + f.dandan_episode_id }
        await apiV2('/episodes/links', { method: 'POST', body })
        ElMessage.success('创建成功'); createVisible.value = false; reload()
      } catch (e) { ElMessage.error(e.message) }
    }

    const fmt = (s) => (s ? new Date(s).toLocaleString() : '—')
    // 置信度色彩：>=80 绿 / >=50 黄 / 其余红，便于发现需核对的低置信链接
    const confType = (c) => (c >= 80 ? 'success' : c >= 50 ? 'warning' : 'danger')

    onMounted(() => { load(); loadStats() })
    return { items, total, page, pageSize, keyword, episodeId, matchSource, stats, loading,
      sourceOptions, fixVisible, form, createVisible, createForm, Search, Plus,
      reload, onPage, openFix, saveFix, openCreate, saveCreate, fmt, confType }
  }
}
</script>

<style scoped>
.stat-row { margin-bottom: 16px; }
.stat-card { border-radius: 10px; }
.stat-card.is-accent { background: #ecf5ff; }
.stat-label { font-size: 13px; color: #909399; }
.stat-value { font-size: 26px; font-weight: 600; color: #303133; margin-top: 4px; }
.stat-sub { font-size: 12px; color: #c0c4cc; margin-top: 2px; }
.src-tags { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 8px; }
.src-tag { font-family: monospace; }
</style>