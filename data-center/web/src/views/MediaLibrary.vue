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
        <!-- 外部平台 ID：数据来自 bangumi 响应的 onlineDatabases[]，可人工补填 -->
        <el-divider>外部平台 ID</el-divider>
        <el-table :data="meta.external_ids" size="small" empty-text="暂无外部 ID">
          <el-table-column prop="provider" label="平台" width="110" />
          <el-table-column prop="external_id" label="ID" show-overflow-tooltip />
          <el-table-column label="来源" width="70">
            <template #default="{ row }">
              <el-tag :type="row.source === 'manual' ? 'warning' : 'info'" size="small">
                {{ row.source === 'manual' ? '手动' : '自动' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="110">
            <template #default="{ row }">
              <el-link v-if="row.external_url" type="primary" :href="row.external_url"
                       target="_blank" rel="noreferrer">跳转</el-link>
              <el-link type="danger" style="margin-left: 8px"
                       @click="delExternalId(row.id)">删除</el-link>
            </template>
          </el-table-column>
        </el-table>
        <!-- provider 用 datalist 给建议但不限制，新增平台无需改代码 -->
        <div class="add-row">
          <el-input v-model="extForm.provider" placeholder="平台标识" size="small"
                    list="provider-suggest" style="width: 130px" />
          <datalist id="provider-suggest">
            <option v-for="p in providerSuggest" :key="p" :value="p" />
          </datalist>
          <el-input v-model="extForm.external_id" placeholder="ID" size="small" style="width: 130px" />
          <el-input v-model="extForm.external_url" placeholder="URL（可选）" size="small" style="flex: 1" />
          <el-button size="small" type="primary" @click="saveExternalId">添加</el-button>
        </div>

        <!-- 别名：approved 参与线上搜索解析，pending 需人工确认 -->
        <el-divider>别名（{{ meta.aliases.length }}）</el-divider>
        <el-table :data="meta.aliases" size="small" max-height="30vh" empty-text="暂无别名">
          <el-table-column prop="alias" label="别名" show-overflow-tooltip />
          <el-table-column prop="lang" label="语言" width="90" />
          <el-table-column prop="source" label="来源" width="130" show-overflow-tooltip />
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="aliasTagType(row.status)" size="small">
                {{ aliasStatusText(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="130">
            <template #default="{ row }">
              <template v-if="row.status === 'pending'">
                <el-link type="success" @click="reviewAlias(row.id, true)">通过</el-link>
                <el-link type="warning" style="margin-left: 6px"
                         @click="reviewAlias(row.id, false)">拒绝</el-link>
              </template>
              <el-link type="danger" style="margin-left: 6px"
                       @click="delAlias(row.id)">删除</el-link>
            </template>
          </el-table-column>
        </el-table>
        <div class="add-row">
          <el-input v-model="aliasForm.alias" placeholder="新增别名（提交即生效）"
                    size="small" style="flex: 1" />
          <el-select v-model="aliasForm.lang" size="small" style="width: 110px">
            <el-option v-for="l in langOptions" :key="l.value"
                       :label="l.label" :value="l.value" />
          </el-select>
          <el-button size="small" type="primary" @click="saveAlias">添加</el-button>
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
    // 外部 ID 与别名（与 detail 分开请求，抽屉打开时并发拉取）
    const meta = ref({ external_ids: [], aliases: [] })
    const extForm = ref({ provider: '', external_id: '', external_url: '' })
    const aliasForm = ref({ alias: '', lang: 'zh-Hans' })
    // provider 只作输入建议，不限制取值——新增平台无需改代码
    const providerSuggest = ['bangumi_tv', 'anidb', 'mal', 'anilist', 'tmdb',
      'imdb', 'tvdb', 'anisearch', 'animeplanet', 'bilibili']
    const langOptions = [
      { label: '简体', value: 'zh-Hans' },
      { label: '繁体', value: 'zh-Hant' },
      { label: '日语', value: 'ja' },
      { label: '罗马字', value: 'ja-romaji' },
      { label: '英语', value: 'en' },
      { label: '未知', value: 'unknown' },
    ]

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

    // 拉取外部 ID 与别名；失败不阻塞抽屉展示（属增值信息）
    const loadMeta = async (animeId) => {
      try {
        const res = await apiV2(`/media/meta/${animeId}`)
        meta.value = res.data || { external_ids: [], aliases: [] }
      } catch (e) { meta.value = { external_ids: [], aliases: [] } }
    }

    const openDetail = async (animeId) => {
      try {
        const res = await apiV2(`/media/${animeId}`)
        detail.value = res.data
        drawerVisible.value = true
        // 重置新增表单，避免上一个番剧的残留输入
        extForm.value = { provider: '', external_id: '', external_url: '' }
        aliasForm.value = { alias: '', lang: 'zh-Hans' }
        await loadMeta(animeId)
      } catch (e) { ElMessage.error(e.message) }
    }

    // 别名状态的展示映射：approved 已生效 / pending 待确认 / rejected 已拒绝
    const aliasStatusText = (s) => (
      s === 'approved' ? '已生效' : s === 'pending' ? '待确认' : '已拒绝')
    const aliasTagType = (s) => (
      s === 'approved' ? 'success' : s === 'pending' ? 'warning' : 'info')

    const saveExternalId = async () => {
      if (!extForm.value.provider) { ElMessage.warning('请填写平台标识'); return }
      try {
        await apiV2(`/media/meta/${detail.value.anime_id}/external-id`,
          { method: 'PUT', body: JSON.stringify(extForm.value) })
        ElMessage.success('已保存')
        extForm.value = { provider: '', external_id: '', external_url: '' }
        await loadMeta(detail.value.anime_id)
      } catch (e) { ElMessage.error(e.message) }
    }
    const delExternalId = async (rowId) => {
      try {
        await apiV2(`/media/meta/external-id/${rowId}`, { method: 'DELETE' })
        await loadMeta(detail.value.anime_id)
      } catch (e) { ElMessage.error(e.message) }
    }
    const saveAlias = async () => {
      if (!aliasForm.value.alias) { ElMessage.warning('请填写别名'); return }
      try {
        await apiV2(`/media/meta/${detail.value.anime_id}/alias`,
          { method: 'PUT', body: JSON.stringify(aliasForm.value) })
        ElMessage.success('已保存')
        aliasForm.value = { alias: '', lang: 'zh-Hans' }
        await loadMeta(detail.value.anime_id)
      } catch (e) { ElMessage.error(e.message) }
    }
    const reviewAlias = async (rowId, approve) => {
      try {
        await apiV2(`/media/meta/alias/${rowId}/review`,
          { method: 'PUT', body: JSON.stringify({ approve }) })
        await loadMeta(detail.value.anime_id)
      } catch (e) { ElMessage.error(e.message) }
    }
    const delAlias = async (rowId) => {
      try {
        await apiV2(`/media/meta/alias/${rowId}`, { method: 'DELETE' })
        await loadMeta(detail.value.anime_id)
      } catch (e) { ElMessage.error(e.message) }
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
      drawerVisible, detail, Search, Refresh, reload, onPage, onSizeChange, openDetail, coverStyle, onImgError, rebuild,
      meta, extForm, aliasForm, providerSuggest, langOptions,
      aliasStatusText, aliasTagType,
      saveExternalId, delExternalId, saveAlias, reviewAlias, delAlias }
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

/* 外部 ID / 别名的行内新增表单 */
.add-row { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
</style>
