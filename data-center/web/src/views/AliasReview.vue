<template>
  <div class="app-page">
    <h1 class="app-page__title">别名校验</h1>
    <p class="page-desc">
      以番剧为主视角：每部番剧下列出它名下的别名。待确认的词可以「通过」、「拒绝」，
      或在算法挂错时「改挂」到正确的番剧。确认后的别名会让客户端搜不到的词自动改写为规范词回源。
    </p>

    <div class="app-toolbar">
      <el-radio-group v-model="onlyPending" size="small" @change="reload">
        <el-radio-button :value="true">待确认的番剧</el-radio-button>
        <el-radio-button :value="false">全部番剧</el-radio-button>
      </el-radio-group>
      <el-input v-model="keyword" placeholder="搜索番剧名" clearable size="small"
                style="width: 200px" @keyup.enter="reload" @clear="reload" />
      <el-button size="small" :icon="Search" @click="reload">查询</el-button>
      <el-button size="small" :icon="Refresh" @click="reload">刷新</el-button>
      <el-button size="small" type="primary" @click="openLink">手动挂词</el-button>
      <el-dropdown size="small" @command="runTask">
        <el-button size="small">
          批量任务<el-icon><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="generate">生成候选（扫空结果词）</el-dropdown-item>
            <el-dropdown-item command="ai">AI 打分（低置信度）</el-dropdown-item>
            <el-dropdown-item command="external">外部源补充（TMDB/BGM）</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <span class="app-toolbar__spacer" />
      <span class="tip">共 {{ total }} 部番剧</span>
    </div>

    <div v-loading="loading" class="anime-list">
      <el-empty v-if="!items.length"
                :description="onlyPending ? '没有待确认的别名' : '暂无别名记录'" />

      <div v-for="a in items" :key="a.anime_id" class="anime-card">
        <!-- 番剧头部：海报 + 标题 + 外链，判断别名归属时的主要参照 -->
        <div class="anime-head">
          <img v-if="a.image_url" :src="a.image_url" class="poster"
               loading="lazy" referrerpolicy="no-referrer" @error="onImgError" />
          <div v-else class="poster poster-ph">{{ (a.title || '?').slice(0, 2) }}</div>
          <div class="anime-meta">
            <div class="anime-title" :title="a.title">{{ a.title }}</div>
            <div class="anime-sub">
              <span class="app-mono">animeId {{ a.anime_id }}</span>
              <el-link v-if="a.links.bangumi_tv" type="primary" :href="a.links.bangumi_tv"
                       target="_blank" rel="noreferrer">BGM</el-link>
              <el-link v-if="a.links.tmdb" type="primary" :href="a.links.tmdb"
                       target="_blank" rel="noreferrer">TMDB</el-link>
              <span class="muted">已生效 {{ a.approved.length }} · 待确认 {{ a.pending.length }}</span>
            </div>
          </div>
        </div>

        <!-- 待确认：需要决策的部分放最前 -->
        <div v-if="a.pending.length" class="alias-block">
          <div class="block-title">待确认</div>
          <div v-for="p in a.pending" :key="p.id" class="alias-row">
            <el-tag :type="confType(p.confidence)" size="small">{{ p.confidence }}</el-tag>
            <span class="alias-text" :title="p.alias">{{ p.alias }}</span>
            <span class="hit">命中 {{ p.hit }}</span>
            <span class="src">{{ srcText(p.source) }}</span>
            <span v-if="p.ai_suggestion" class="ai" :title="p.ai_suggestion.reason">
              AI {{ p.ai_suggestion.confidence }}
            </span>
            <span class="app-toolbar__spacer" />
            <el-link type="success" @click="review(p.id, true)">通过</el-link>
            <el-link type="warning" @click="review(p.id, false)">拒绝</el-link>
            <el-link type="primary" @click="openReassign(p, a)">改挂</el-link>
          </div>
        </div>

        <!-- 已生效：默认折叠，展开供对照参考 -->
        <div v-if="a.approved.length" class="alias-block">
          <div class="block-title clickable" @click="toggle(a.anime_id)">
            已生效（{{ a.approved.length }}）
            <el-icon><component :is="expanded[a.anime_id] ? 'ArrowUp' : 'ArrowDown'" /></el-icon>
          </div>
          <template v-if="expanded[a.anime_id]">
            <div v-for="p in a.approved" :key="p.id" class="alias-row">
              <el-tag type="success" size="small" effect="plain">{{ p.confidence }}</el-tag>
              <span class="alias-text" :title="p.alias">{{ p.alias }}</span>
              <span class="src">{{ srcText(p.source) }}</span>
              <span class="app-toolbar__spacer" />
              <el-link type="primary" @click="openReassign(p, a)">改挂</el-link>
              <el-link type="danger" @click="del(p.id)">删除</el-link>
            </div>
          </template>
        </div>
      </div>
    </div>

    <el-pagination v-if="total > pageSize" class="app-pager" background
                   layout="total, prev, pager, next" :total="total"
                   :current-page="page" :page-size="pageSize" @current-change="onPage" />

    <!-- 改挂弹窗：搜番剧后点「挂到这部」 -->
    <el-dialog v-model="reassignVisible" title="改挂到其他番剧" width="600px">
      <div class="dlg-hint">
        把别名 <b>{{ reassignAlias ? reassignAlias.alias : '' }}</b>
        <template v-if="reassignFrom"> 从「{{ reassignFrom.title }}」</template>
        改挂到下面选中的番剧。原番剧的记录会标为「已拒绝」留痕，不删除。
      </div>
      <div class="app-toolbar">
        <el-input v-model="targetKw" placeholder="搜索目标番剧名" clearable size="small"
                  style="width: 260px" @keyup.enter="searchTarget" />
        <el-button size="small" type="primary" @click="searchTarget">搜索</el-button>
      </div>
      <el-table :data="targets" size="small" max-height="320px"
                empty-text="输入番剧名后搜索">
        <el-table-column prop="title" label="番剧" show-overflow-tooltip />
        <el-table-column prop="anime_id" label="animeId" width="100" />
        <el-table-column label="操作" width="110">
          <template #default="{ row }">
            <el-link type="primary" @click="doReassign(row.anime_id)">挂到这部</el-link>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <!-- 手动挂词：从已缓存的搜索词里挑，再选番剧 -->
    <el-dialog v-model="linkVisible" title="手动挂词" width="640px">
      <div class="dlg-hint">
        搜索已缓存的响应搜索词，选中后指定它属于哪部番剧。
        用于算法没生成候选、或候选被拒后的人工补充。
      </div>
      <div class="app-toolbar">
        <el-input v-model="termKw" placeholder="搜索缓存里的搜索词" clearable size="small"
                  style="width: 260px" @keyup.enter="searchTerms" />
        <el-checkbox v-model="onlyUnlinked" size="small" @change="searchTerms">
          仅未关联
        </el-checkbox>
        <el-button size="small" type="primary" @click="searchTerms">搜索</el-button>
      </div>
      <el-table :data="terms" size="small" max-height="320px"
                empty-text="输入关键词后搜索（留空搜命中最高的）">
        <el-table-column prop="term" label="搜索词" show-overflow-tooltip />
        <el-table-column prop="hit" label="命中" width="80" />
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.is_empty" type="danger" size="small" effect="plain">搜不到</el-tag>
            <el-tag v-else type="success" size="small" effect="plain">有结果</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110">
          <template #default="{ row }">
            <el-link type="primary" @click="pickTerm(row)">选它</el-link>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Search, ArrowDown } from '@element-plus/icons-vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'AliasReview',
  setup() {
    const items = ref([])
    const total = ref(0)
    const page = ref(1)
    const pageSize = ref(10)
    const onlyPending = ref(true)
    const keyword = ref('')
    const loading = ref(false)
    const expanded = reactive({})

    const load = async () => {
      loading.value = true
      try {
        const qs = new URLSearchParams({
          only_pending: String(onlyPending.value),
          page: String(page.value),
          page_size: String(pageSize.value),
        })
        if (keyword.value) qs.set('keyword', keyword.value)
        const res = await apiV2(`/media/alias/by-anime?${qs}`)
        items.value = res.items || []
        total.value = res.total || 0
      } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
    }
    const reload = () => { page.value = 1; load() }
    const onPage = (p) => { page.value = p; load() }
    const toggle = (id) => { expanded[id] = !expanded[id] }
    const onImgError = (e) => { e.target.style.visibility = 'hidden' }

    // 置信度配色：90+ 绿（季号精确对上）、75+ 蓝、其余橙（需人工细看）
    const confType = (c) => (c >= 90 ? 'success' : c >= 75 ? '' : 'warning')

    // source 是内部标识，直接显示读不懂
    const SRC_TEXT = {
      dandanplay_titles: '官方别名',
      cache_extract_1: '搜索词精确命中',
      cache_extract_n: '搜索词命中系列',
      auto_match: '算法季号对齐',
      tmdb: 'TMDB', bgm: 'Bangumi', manual: '人工',
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
        await ElMessageBox.confirm('删除这条别名？', '确认', { type: 'warning' })
      } catch { return }
      try {
        await apiV2(`/media/meta/alias/${id}`, { method: 'DELETE' })
        ElMessage.success('已删除')
        await load()
      } catch (e) { ElMessage.error(e.message) }
    }

    // ---------- 改挂 ----------
    const reassignVisible = ref(false)
    const reassignAlias = ref(null)
    const reassignFrom = ref(null)
    const targetKw = ref('')
    const targets = ref([])

    const openReassign = (aliasRow, anime) => {
      reassignAlias.value = aliasRow
      reassignFrom.value = anime
      // 用别名前几个字预填：目标番剧名通常与别名相近，省一次输入
      targetKw.value = (aliasRow.alias || '').slice(0, 10)
      targets.value = []
      reassignVisible.value = true
      if (targetKw.value) searchTarget()
    }

    const searchTarget = async () => {
      if (!targetKw.value) { targets.value = []; return }
      try {
        const res = await apiV2(
          `/media/library?keyword=${encodeURIComponent(targetKw.value)}&page_size=30`)
        targets.value = (res.items || []).map(
          (m) => ({ anime_id: m.anime_id, title: m.title }))
      } catch (e) { ElMessage.error(e.message) }
    }

    const doReassign = async (targetId) => {
      const row = reassignAlias.value
      if (!row) return
      try {
        // id 为 null 表示是「手动挂词」流程里选的缓存词，走新增接口
        if (row.id == null) {
          await apiV2(`/media/meta/${targetId}/alias`, {
            method: 'PUT',
            body: JSON.stringify({ alias: row.alias, title_type: 'search_keyword' }),
          })
          ElMessage.success('已关联')
        } else {
          await apiV2(`/media/meta/alias/${row.id}/reassign`, {
            method: 'PUT', body: JSON.stringify({ target_anime_id: targetId }),
          })
          ElMessage.success('已改挂')
        }
        reassignVisible.value = false
        await load()
      } catch (e) { ElMessage.error(e.message) }
    }

    // ---------- 手动挂词 ----------
    const linkVisible = ref(false)
    const termKw = ref('')
    const onlyUnlinked = ref(true)
    const terms = ref([])

    const openLink = () => {
      terms.value = []
      linkVisible.value = true
      searchTerms()
    }

    const searchTerms = async () => {
      try {
        const qs = new URLSearchParams({
          only_unlinked: String(onlyUnlinked.value), limit: '30',
        })
        if (termKw.value) qs.set('keyword', termKw.value)
        const res = await apiV2(`/media/alias/cached-terms?${qs}`)
        terms.value = res || []
      } catch (e) { ElMessage.error(e.message) }
    }

    // 选中缓存词后复用改挂弹窗选番剧：id 为 null 走新增分支
    const pickTerm = (row) => {
      reassignAlias.value = { id: null, alias: row.term }
      reassignFrom.value = null
      targetKw.value = (row.term || '').slice(0, 10)
      targets.value = []
      linkVisible.value = false
      reassignVisible.value = true
      if (targetKw.value) searchTarget()
    }

    // ---------- 批量任务 ----------
    const runTask = async (cmd) => {
      const MAP = {
        generate: ['/media/alias/generate', '已生成候选'],
        ai: ['/media/alias/ai-score', '已打分'],
        external: ['/media/alias/external', '已补充'],
      }
      const [url, okMsg] = MAP[cmd] || []
      if (!url) return
      const done = ElMessage.info({ message: '任务执行中…', duration: 0 })
      try {
        const res = await apiV2(url, { method: 'POST' })
        ElMessage.success(res.message || okMsg)
        await load()
      } catch (e) { ElMessage.error(e.message) } finally { done.close() }
    }

    onMounted(load)
    return {
      items, total, page, pageSize, onlyPending, keyword, loading, expanded,
      Refresh, Search, ArrowDown,
      reload, onPage, toggle, onImgError, confType, srcText, review, del,
      reassignVisible, reassignAlias, reassignFrom, targetKw, targets,
      openReassign, searchTarget, doReassign,
      linkVisible, termKw, onlyUnlinked, terms, openLink, searchTerms, pickTerm,
      runTask,
    }
  },
}
</script>

<style scoped>
.page-desc { color: #909399; font-size: 13px; margin-bottom: 16px; line-height: 1.6; }
.tip { color: #909399; font-size: 12px; }
.muted { color: #c0c4cc; }

.anime-list { min-height: 160px; }
.anime-card {
  border: 1px solid #ebeef5; border-radius: 6px;
  padding: 12px; margin-bottom: 12px; background: #fff;
}
.anime-head { display: flex; gap: 12px; align-items: flex-start; }
.poster {
  width: 48px; height: 68px; object-fit: cover;
  border-radius: 4px; flex-shrink: 0; background: #f5f7fa;
}
.poster-ph {
  display: flex; align-items: center; justify-content: center;
  color: #c0c4cc; font-size: 16px;
}
.anime-meta { flex: 1; min-width: 0; }
/* 番剧标题是判断别名归属的主参照，给足字号 */
.anime-title {
  font-size: 15px; font-weight: 600; color: #303133;
  line-height: 1.4; word-break: break-all;
}
.anime-sub {
  display: flex; gap: 12px; align-items: center;
  flex-wrap: wrap; margin-top: 6px; font-size: 12px; color: #909399;
}

.alias-block { margin-top: 10px; }
.block-title {
  font-size: 12px; color: #909399; font-weight: 600;
  padding: 4px 0; display: flex; align-items: center; gap: 4px;
}
.clickable { cursor: pointer; user-select: none; }
.clickable:hover { color: #409eff; }
.alias-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 4px; font-size: 13px;
  border-top: 1px dashed #f2f6fc;
}
/* 别名是主信息，长词换行而非截断 */
.alias-text { color: #606266; word-break: break-all; }
.hit { color: #e6a23c; font-size: 12px; flex-shrink: 0; }
.src { color: #909399; font-size: 12px; flex-shrink: 0; }
.ai { color: #909399; font-size: 12px; flex-shrink: 0; }

.dlg-hint {
  color: #909399; font-size: 13px; line-height: 1.6; margin-bottom: 12px;
}
</style>

