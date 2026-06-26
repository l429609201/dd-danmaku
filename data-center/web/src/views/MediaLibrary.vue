<template>
  <div class="app-page">
    <h1 class="app-page__title">媒体库</h1>
    <p class="page-desc">按番剧聚合展示库内现有媒体信息，标识每部番剧的弹幕覆盖与缺失情况。</p>

    <div class="app-toolbar">
      <el-input v-model="keyword" placeholder="搜索番剧名" clearable style="width: 240px" @keyup.enter="reload" />
      <el-checkbox v-model="onlyMissing" label="仅看有缺失" border @change="reload" />
      <el-button type="primary" :icon="Search" @click="reload">查询</el-button>
    </div>

    <div v-loading="loading">
      <el-empty v-if="!items.length" description="暂无媒体数据（需 Worker 抓取番剧详情后生成）" />
      <el-row :gutter="16" v-else>
        <el-col :span="6" v-for="m in items" :key="m.anime_id" class="media-col">
          <el-card shadow="hover" class="media-card" @click="openDetail(m.anime_id)">
            <div class="cover" :style="coverStyle(m.image_proxy)">
              <span v-if="!m.image_proxy" class="cover-ph">{{ (m.title || '?').slice(0, 2) }}</span>
              <el-tag v-if="m.type_desc" size="small" class="type-tag">{{ m.type_desc }}</el-tag>
            </div>
            <div class="media-title" :title="m.title">{{ m.title }}</div>
            <div class="media-sub">animeId: {{ m.anime_id }} · {{ m.ep_total }} 集</div>
            <div class="prog-line">
              <span>弹幕 {{ m.danmaku_count }}/{{ m.ep_total }}</span>
              <span :class="m.missing_danmaku > 0 ? 'miss' : 'ok'">
                {{ m.missing_danmaku > 0 ? `缺 ${m.missing_danmaku}` : '完整' }}
              </span>
            </div>
            <el-progress :percentage="m.danmaku_ratio"
                         :status="m.danmaku_ratio >= 100 ? 'success' : m.danmaku_ratio < 50 ? 'exception' : ''"
                         :stroke-width="8" />
          </el-card>
        </el-col>
      </el-row>
      <div class="app-pager" v-if="total > pageSize">
        <el-pagination layout="prev, pager, next, total" :total="total"
                       :page-size="pageSize" :current-page="page" @current-change="onPage" />
      </div>
    </div>

    <!-- 番剧详情抽屉 -->
    <el-drawer v-model="drawerVisible" :title="detail ? detail.title : '番剧详情'" size="46%">
      <template v-if="detail">
        <div class="detail-head">
          <div class="cover-lg" :style="coverStyle(detail.image_proxy)">
            <span v-if="!detail.image_proxy" class="cover-ph">{{ detail.title.slice(0, 2) }}</span>
          </div>
          <div class="detail-meta">
            <div class="meta-row"><b>animeId</b> {{ detail.anime_id }}</div>
            <div class="meta-row"><b>类型</b> {{ detail.type_desc || '—' }}</div>
            <div class="meta-row" v-if="detail.rating"><b>评分</b> {{ detail.rating }}</div>
            <div class="meta-row"><b>弹幕覆盖</b> {{ detail.danmaku_count }}/{{ detail.ep_total }}（缺 {{ detail.missing_danmaku }}）</div>
            <div class="summary" v-if="detail.summary">{{ detail.summary }}</div>
          </div>
        </div>
        <el-divider>分集状态</el-divider>
        <el-table :data="detail.episodes" size="small" max-height="50vh">
          <el-table-column prop="episode_number" label="集" width="60" />
          <el-table-column prop="episode_title" label="标题" show-overflow-tooltip />
          <el-table-column prop="episode_id" label="episodeId" width="100" />
          <el-table-column label="弹幕" width="90">
            <template #default="{ row }">
              <el-tag v-if="row.has_danmaku" type="success" size="small">{{ row.comment_count }}</el-tag>
              <el-tag v-else type="info" size="small">缺失</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </el-drawer>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'MediaLibrary',
  setup() {
    const items = ref([])
    const total = ref(0)
    const page = ref(1)
    const pageSize = ref(12)
    const keyword = ref('')
    const onlyMissing = ref(false)
    const loading = ref(false)
    const drawerVisible = ref(false)
    const detail = ref(null)

    const load = async () => {
      loading.value = true
      try {
        const q = new URLSearchParams({ page: page.value, page_size: pageSize.value })
        if (keyword.value) q.set('keyword', keyword.value)
        if (onlyMissing.value) q.set('only_missing', 'true')
        const res = await apiV2(`/media/library?${q.toString()}`)
        items.value = res.items || []
        total.value = res.total || 0
      } catch (e) { ElMessage.error(e.message) } finally { loading.value = false }
    }
    const reload = () => { page.value = 1; load() }
    const onPage = (p) => { page.value = p; load() }

    const openDetail = async (animeId) => {
      try { const res = await apiV2(`/media/${animeId}`); detail.value = res.data; drawerVisible.value = true }
      catch (e) { ElMessage.error(e.message) }
    }
    // 封面背景样式：有图用图，无图显示占位底色
    const coverStyle = (url) => (url
      ? { backgroundImage: `url(${url})` }
      : { background: 'linear-gradient(135deg, #c6d4e8, #93a8c9)' })

    onMounted(load)
    return { items, total, page, pageSize, keyword, onlyMissing, loading,
      drawerVisible, detail, Search, reload, onPage, openDetail, coverStyle }
  }
}
</script>

<style scoped>
.page-desc { color: #909399; font-size: 13px; margin-bottom: 16px; }
.media-col { margin-bottom: 16px; }
.media-card { border-radius: 12px; cursor: pointer; transition: transform .15s; }
.media-card:hover { transform: translateY(-3px); }
.cover { position: relative; height: 150px; border-radius: 8px; background-size: cover; background-position: center;
  display: flex; align-items: center; justify-content: center; margin-bottom: 10px; overflow: hidden; }
.cover-ph { color: #fff; font-size: 28px; font-weight: 700; opacity: .85; }
.type-tag { position: absolute; top: 8px; left: 8px; }
.media-title { font-size: 14px; font-weight: 600; color: #303133; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.media-sub { font-size: 12px; color: #909399; margin: 2px 0 8px; }
.prog-line { display: flex; justify-content: space-between; font-size: 12px; color: #606266; margin-bottom: 4px; }
.prog-line .miss { color: #e6a23c; }
.prog-line .ok { color: #67c23a; }
.detail-head { display: flex; gap: 16px; }
.cover-lg { width: 120px; height: 168px; border-radius: 8px; background-size: cover; background-position: center;
  flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.detail-meta { flex: 1; font-size: 13px; }
.meta-row { margin-bottom: 8px; color: #606266; }
.meta-row b { color: #909399; margin-right: 8px; font-weight: 500; }
.summary { margin-top: 10px; color: #909399; line-height: 1.6; max-height: 96px; overflow: auto; }
</style>
