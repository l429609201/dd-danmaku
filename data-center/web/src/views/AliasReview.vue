<template>
  <div>
    <h2 class="page-title">别名校验</h2>
    <p class="page-desc">
      客户端搜不到结果的词，算法已在库里找到疑似对应的规范标题。
      确认后该词会被自动改写为规范词回源，把原本注定为空的搜索变成有结果的搜索。
      按命中数降序排列，先修最热的收益最大。
    </p>

    <div class="toolbar">
      <el-select v-model="status" size="small" style="width: 130px" @change="reload">
        <el-option label="待确认" value="pending" />
        <el-option label="已生效" value="approved" />
        <el-option label="已拒绝" value="rejected" />
      </el-select>
      <el-button size="small" :icon="Refresh" @click="reload">刷新</el-button>
      <el-button size="small" type="primary" :loading="generating" @click="generate">
        生成候选
      </el-button>
      <el-button size="small" :loading="scoring" @click="aiScore">AI 打分</el-button>
      <el-button size="small" :loading="supplementing" @click="external">外部源补充</el-button>
      <span class="tip">共 {{ total }} 条</span>
    </div>

    <el-table :data="items" v-loading="loading" size="small"
              empty-text="暂无待校验别名（可点「生成候选」扫描空结果搜索词）">
      <el-table-column prop="alias" label="客户端搜索词" min-width="200" show-overflow-tooltip />
      <el-table-column prop="hit_snapshot" label="命中" width="90" sortable />
      <el-table-column label="推荐匹配" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="row.candidate_title">{{ row.candidate_title }}</span>
          <span v-else class="muted">（媒体库无此条目 {{ row.anime_id }}）</span>
        </template>
      </el-table-column>
      <el-table-column label="置信度" width="90">
        <template #default="{ row }">
          <el-tag :type="confType(row.confidence)" size="small">{{ row.confidence }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="source" label="来源" width="130" show-overflow-tooltip />
      <!-- AI 建议仅作人工参考：不改 status/confidence，是否上线仍由人工点确认 -->
      <el-table-column label="AI 建议" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">
          <template v-if="row.ai_suggestion">
            <el-tag :type="confType(row.ai_suggestion.confidence)" size="small">
              {{ row.ai_suggestion.confidence }}
            </el-tag>
            <span class="ai-reason">{{ row.ai_suggestion.reason }}</span>
          </template>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="核对" width="110">
        <template #default="{ row }">
          <el-link v-if="row.links && row.links.bangumi_tv" type="primary"
                   :href="row.links.bangumi_tv" target="_blank" rel="noreferrer">BGM</el-link>
          <el-link v-if="row.links && row.links.tmdb" type="primary" style="margin-left: 6px"
                   :href="row.links.tmdb" target="_blank" rel="noreferrer">TMDB</el-link>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="150">
        <template #default="{ row }">
          <template v-if="row.status === 'pending'">
            <el-link type="success" @click="review(row.id, true)">通过</el-link>
            <el-link type="warning" style="margin-left: 8px"
                     @click="review(row.id, false)">拒绝</el-link>
          </template>
          <el-link type="danger" style="margin-left: 8px" @click="del(row.id)">删除</el-link>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination v-if="total > pageSize" class="pager" background
                   layout="total, prev, pager, next" :total="total"
                   :current-page="page" :page-size="pageSize" @current-change="onPage" />
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'AliasReview',
  setup() {
    const items = ref([])
    const total = ref(0)
    const page = ref(1)
    const pageSize = ref(20)
    const status = ref('pending')
    const loading = ref(false)
    const generating = ref(false)
    const scoring = ref(false)
    const supplementing = ref(false)

    const load = async () => {
      loading.value = true
      try {
        const q = new URLSearchParams({
          status: status.value, page: page.value, page_size: pageSize.value,
        })
        const res = await apiV2(`/media/alias/pending?${q.toString()}`)
        items.value = res.items || []
        total.value = res.total || 0
      } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
    }
    const reload = () => { page.value = 1; load() }
    const onPage = (p) => { page.value = p; load() }

    // 置信度配色：90+ 绿（季号精确对上）、75+ 蓝、其余橙（需人工细看）
    const confType = (c) => (c >= 90 ? 'success' : c >= 75 ? '' : 'warning')

    const review = async (id, approve) => {
      try {
        await apiV2(`/media/meta/alias/${id}/review`, {
          method: 'PUT', body: JSON.stringify({ approve }),
        })
        ElMessage.success(approve ? '已生效' : '已拒绝')
        await load()
      } catch (e) { ElMessage.error(e.message) }
    }
    const del = async (id) => {
      try {
        await apiV2(`/media/meta/alias/${id}`, { method: 'DELETE' })
        ElMessage.success('已删除')
        await load()
      } catch (e) { ElMessage.error(e.message) }
    }

    // 扫空结果负缓存生成候选：产出一律 pending，不会直接影响线上
    const generate = async () => {
      generating.value = true
      try {
        const res = await apiV2('/media/alias/generate?limit=200', { method: 'POST' })
        ElMessage.success(res.message || '已生成')
        status.value = 'pending'
        page.value = 1
        await load()
      } catch (e) { ElMessage.error(e.message) } finally { generating.value = false }
    }

    // 让 AI 给低置信度候选打分：只写 ai_suggestion，不改状态，仍需人工确认
    const aiScore = async () => {
      scoring.value = true
      try {
        const res = await apiV2('/media/alias/ai-score', { method: 'POST' })
        ElMessage.success(res.message || '已打分')
        await load()
      } catch (e) { ElMessage.error(e.message) } finally { scoring.value = false }
    }

    // 外部源（TMDB/BGM）补充：拿外部别名回本地二次匹配，产出仍是 pending
    const external = async () => {
      supplementing.value = true
      try {
        const res = await apiV2('/media/alias/external', { method: 'POST' })
        ElMessage.success(res.message || '已补充')
        status.value = 'pending'
        page.value = 1
        await load()
      } catch (e) { ElMessage.error(e.message) } finally { supplementing.value = false }
    }

    onMounted(load)
    return { items, total, page, pageSize, status, loading, generating, scoring,
      supplementing, Refresh, reload, onPage, confType, review, del,
      generate, aiScore, external }
  }
}
</script>

<style scoped>
.page-desc { color: #909399; font-size: 13px; margin-bottom: 16px; line-height: 1.6; }
.toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; }
.tip { color: #909399; font-size: 12px; margin-left: auto; }
.muted { color: #c0c4cc; }
.ai-reason { color: #909399; font-size: 12px; margin-left: 6px; }
.pager { margin-top: 16px; justify-content: flex-end; }
</style>
