<template>
  <div class="app-page">
    <h1 class="app-page__title">媒体库</h1>
    <p class="page-desc">按番剧聚合展示库内现有媒体信息，标识每部番剧的弹幕覆盖与缺失情况。</p>

    <div class="app-toolbar">
      <el-input v-model="keyword" placeholder="搜索番剧名" clearable style="width: 240px" @keyup.enter="reload" />
      <el-checkbox v-model="onlyMissing" label="仅看有缺失" border @change="reload" />
      <el-button type="primary" :icon="Search" @click="reload">查询</el-button>
      <el-button :icon="Refresh" :loading="rebuilding" @click="rebuild">从缓存回填</el-button>
    </div>

    <div v-loading="loading">
      <el-empty v-if="!items.length" description="暂无媒体数据（需 Worker 抓取番剧详情后生成）" />
      <div v-else class="poster-grid">
        <div v-for="m in items" :key="m.anime_id" class="poster-card" @click="openDetail(m.anime_id)">
          <!-- 竖式海报：2:3 比例，图片懒加载，无图显示首字占位 -->
          <div class="poster-img">
            <img v-if="m.image_proxy" :src="m.image_proxy" :alt="m.title"
                 loading="lazy" referrerpolicy="no-referrer" @error="onImgError" />
            <div v-else class="poster-ph">{{ (m.title || '?').slice(0, 2) }}</div>
            <span v-if="m.type_desc" class="poster-type">{{ m.type_desc }}</span>
            <span v-if="m.rating" class="poster-rating">⭐ {{ m.rating }}</span>
            <!-- 缺失角标：完整=绿，缺失=橙 -->
            <span class="poster-badge" :class="m.missing_danmaku > 0 ? 'is-miss' : 'is-ok'">
              {{ m.missing_danmaku > 0 ? `缺 ${m.missing_danmaku}` : '完整' }}
            </span>
          </div>
          <div class="poster-meta">
            <div class="poster-title" :title="m.title">{{ m.title }}</div>
            <div class="poster-sub">{{ m.danmaku_count }}/{{ m.ep_total }} 集弹幕</div>
            <el-progress :percentage="m.danmaku_ratio" :show-text="false"
                         :status="m.danmaku_ratio >= 100 ? 'success' : m.danmaku_ratio < 50 ? 'exception' : ''"
                         :stroke-width="6" />
          </div>
        </div>
      </div>
      <div class="app-pager" v-if="total > pageSize">
        <el-pagination layout="sizes, prev, pager, next, total" :total="total"
                       :page-size="pageSize" :page-sizes="[12, 24, 36, 48, 60]"
                       :current-page="page" @current-change="onPage" @size-change="onSizeChange" />
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
import { Search, Refresh } from '@element-plus/icons-vue'
import { apiV2 } from '../utils/api.js'

export default {
  name: 'MediaLibrary',
  setup() {
    const items = ref([])
    const total = ref(0)
    const page = ref(1)
    const pageSize = ref(24)
    const keyword = ref('')
    const onlyMissing = ref(false)
    const loading = ref(false)
    const rebuilding = ref(false)
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
    // 切换每页数量：重置到第一页再加载
    const onSizeChange = (s) => { pageSize.value = s; page.value = 1; load() }

    const openDetail = async (animeId) => {
      try { const res = await apiV2(`/media/${animeId}`); detail.value = res.data; drawerVisible.value = true }
      catch (e) { ElMessage.error(e.message) }
    }
    // 封面背景样式：有图用图，无图显示占位底色（详情抽屉用）
    const coverStyle = (url) => (url
      ? { backgroundImage: `url(${url})` }
      : { background: 'linear-gradient(135deg, #c6d4e8, #93a8c9)' })
    // 海报图加载失败：隐藏 img，露出底层占位（避免浏览器破图标）
    const onImgError = (e) => { if (e && e.target) e.target.style.display = 'none' }

    // 从已存储的响应缓存批量回填媒体库
    const rebuild = async () => {
      rebuilding.value = true
      try {
        const res = await apiV2('/media/rebuild', { method: 'POST' })
        ElMessage.success(res.message || '回填完成')
        page.value = 1
        await load()
      } catch (e) { ElMessage.error(e.message) } finally { rebuilding.value = false }
    }

    onMounted(load)
    return { items, total, page, pageSize, keyword, onlyMissing, loading, rebuilding,
      drawerVisible, detail, Search, Refresh, reload, onPage, onSizeChange, openDetail, coverStyle, onImgError, rebuild }
  }
}
</script>

<style scoped>
.page-desc { color: #909399; font-size: 13px; margin-bottom: 16px; }

/* 竖式海报网格：自适应列数，窄屏少列、宽屏多列 */
.poster-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 18px;
}
.poster-card {
  background: #fff; border-radius: 12px; overflow: hidden; cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, .06); transition: transform .15s, box-shadow .15s;
}
.poster-card:hover { transform: translateY(-4px); box-shadow: 0 8px 20px rgba(0, 0, 0, .12); }

/* 海报图区：2:3 竖图比例 */
.poster-img {
  position: relative; width: 100%; aspect-ratio: 2 / 3;
  background: linear-gradient(135deg, #c6d4e8, #93a8c9); overflow: hidden;
}
.poster-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.poster-ph {
  width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 32px; font-weight: 700; opacity: .9;
}
.poster-type {
  position: absolute; top: 8px; left: 8px; padding: 2px 8px; border-radius: 6px;
  background: rgba(0, 0, 0, .55); color: #fff; font-size: 11px;
}
.poster-rating {
  position: absolute; top: 8px; right: 8px; padding: 2px 8px; border-radius: 6px;
  background: rgba(0, 0, 0, .55); color: #ffd666; font-size: 11px; font-weight: 600;
}
.poster-badge {
  position: absolute; bottom: 8px; right: 8px; padding: 2px 8px; border-radius: 6px;
  font-size: 11px; font-weight: 600; color: #fff;
}
.poster-badge.is-ok { background: rgba(103, 194, 58, .9); }
.poster-badge.is-miss { background: rgba(230, 162, 60, .92); }

.poster-meta { padding: 10px 12px 12px; }
.poster-title {
  font-size: 14px; font-weight: 600; color: #303133; line-height: 1.4;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.poster-sub { font-size: 12px; color: #909399; margin: 4px 0 8px; }

/* 详情抽屉 */
.detail-head { display: flex; gap: 16px; }
.cover-lg { width: 120px; height: 168px; border-radius: 8px; background-size: cover; background-position: center;
  flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.cover-ph { color: #fff; font-size: 28px; font-weight: 700; opacity: .85; }
.detail-meta { flex: 1; font-size: 13px; }
.meta-row { margin-bottom: 8px; color: #606266; }
.meta-row b { color: #909399; margin-right: 8px; font-weight: 500; }
.summary { margin-top: 10px; color: #909399; line-height: 1.6; max-height: 96px; overflow: auto; }
</style>
