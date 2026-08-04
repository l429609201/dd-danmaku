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

    <!-- 卡片式而非表格：搜索词和候选标题都是长中文，表格列宽一挤就全截断，
         最需要阅读的两列反而看不清。卡片让文本占满整行宽度。 -->
    <div v-loading="loading" class="review-list">
      <el-empty v-if="!items.length"
                description="暂无待校验别名（可点「生成候选」扫描空结果搜索词）" />
      <div v-for="g in items" :key="g.alias_norm" class="review-card">
        <div class="card-head">
          <span class="term" :title="g.alias">{{ g.alias }}</span>
          <el-tag :type="g.hit > 100 ? 'danger' : g.hit > 10 ? 'warning' : 'info'"
                  size="small" effect="plain">命中 {{ g.hit }}</el-tag>
        </div>
        <!-- 一个词可能匹配多个 animeId（系列名），并列展示，各自独立通过/拒绝 -->
        <div v-for="c in g.candidates" :key="c.id" class="cand-row">
          <el-tag :type="confType(c.confidence)" size="small" class="conf">
            {{ c.confidence }}
          </el-tag>
          <span v-if="c.title" class="cand-title" :title="c.title">{{ c.title }}</span>
          <span v-else class="muted">（媒体库无此条目 {{ c.anime_id }}）</span>
          <span class="src">{{ srcText(c.source) }}</span>
          <span v-if="c.ai_suggestion" class="ai" :title="c.ai_suggestion.reason">
            AI {{ c.ai_suggestion.confidence }} · {{ c.ai_suggestion.reason }}
          </span>
          <span class="spacer" />
          <el-link v-if="c.links && c.links.bangumi_tv" type="primary"
                   :href="c.links.bangumi_tv" target="_blank" rel="noreferrer">BGM</el-link>
          <el-link v-if="c.links && c.links.tmdb" type="primary"
                   :href="c.links.tmdb" target="_blank" rel="noreferrer">TMDB</el-link>
          <template v-if="g.status === 'pending'">
            <el-link type="success" @click="review(c.id, true)">通过</el-link>
            <el-link type="warning" @click="review(c.id, false)">拒绝</el-link>
          </template>
          <el-link type="danger" @click="del(c.id)">删除</el-link>
        </div>
      </div>
    </div>

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

    // source 原值是内部标识（cache_extract_n 等），列表里直接显示读不懂
    const SRC_TEXT = {
      dandanplay_titles: '官方别名',
      cache_extract_1: '搜索词精确命中',
      cache_extract_n: '搜索词命中系列',
      auto_match: '算法季号对齐',
      tmdb: 'TMDB',
      bgm: 'Bangumi',
      manual: '人工',
    }
    const srcText = (s) => SRC_TEXT[s] || s || '—'

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
      supplementing, Refresh, reload, onPage, confType, srcText, review, del,
      generate, aiScore, external }
  }
}
</script>

<style scoped>
.page-desc { color: #909399; font-size: 13px; margin-bottom: 16px; line-height: 1.6; }
.toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; }
.tip { color: #909399; font-size: 12px; margin-left: auto; }
.muted { color: #c0c4cc; }
.pager { margin-top: 16px; justify-content: flex-end; }

/* 卡片列表：一个搜索词一张卡，候选逐行排在词下面 */
.review-list { min-height: 120px; }
.review-card {
  border: 1px solid #ebeef5; border-radius: 6px;
  padding: 10px 12px; margin-bottom: 10px; background: #fff;
}
.card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
/* 搜索词是主信息，给足字号与宽度；长词换行而非截断 */
.term {
  font-size: 14px; font-weight: 600; color: #303133;
  word-break: break-all; line-height: 1.4;
}
.cand-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 0 6px 4px; font-size: 13px;
  border-top: 1px dashed #f2f6fc;
}
.conf { flex-shrink: 0; }
.cand-title { color: #606266; word-break: break-all; }
.src { color: #909399; font-size: 12px; flex-shrink: 0; }
.ai {
  color: #909399; font-size: 12px; max-width: 260px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* 把操作区推到右侧，无论中间文本多长都对齐 */
.spacer { flex: 1; }
</style>
