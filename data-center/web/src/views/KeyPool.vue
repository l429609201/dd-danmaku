<template>
  <section>
    <RustSecurityCrud kind="api" />

    <!-- 旧 Worker 密钥池面板：Rust 新模型已在上方；保留旧面板便于对照，待后端补齐后移除 -->
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="Rust 当前 API 密钥模型不是本页的 App ID/Secret 密钥池，尚未实现 UA 授权、配额状态、转发 UA、导入导出及下发。 原功能保留，等待后端补齐；当前不发送旧接口请求。"
      style="margin: 12px 0;"
    />

    <fieldset disabled style="border: 0; padding: 0; margin: 0; min-width: 0; opacity: .65">
      <!-- 密钥池 -->
      <el-card style="margin-bottom: 16px;">
        <template #header>
          <div class="app-toolbar">
            <span style="font-weight: 600;">密钥池</span>
            <el-button size="small" @click="load">刷新</el-button>
            <el-button size="small" @click="openCreate">新增密钥</el-button>
            <el-button size="small" @click="openImport">JSON 导入</el-button>
            <el-button size="small" @click="exportJson">导出 JSON</el-button>
            <el-button size="small" @click="resync">重新下发</el-button>
            <span v-if="updatedAt" class="app-muted" style="margin-left: 8px; font-size: 13px;">更新于 {{ updatedAt }}</span>
          </div>
        </template>

        <el-alert v-if="msg" :title="msg" type="info" :closable="false" style="margin-bottom: 12px;" />

        <!-- 密钥列表 -->
        <div style="margin-bottom: 8px; font-weight: 600; font-size: 14px;">密钥列表</div>
        <el-table :data="items" size="small" border stripe>
          <el-table-column prop="key_id" label="key_id" width="90" />
          <el-table-column prop="app_id" label="App ID" width="140" />
          <el-table-column prop="app_secret" label="App Secret" width="160">
            <template #default="{ row }">
              <span class="app-mono" style="font-size: 12px;">{{ row.app_secret ? '••••••' : '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="授权 UA（空=公共池）" min-width="140">
            <template #default="{ row }">
              <el-tag v-for="ua in (row.auth_ua_keys || [])" :key="ua" size="small" style="margin: 2px;">{{ ua }}</el-tag>
              <span v-if="!(row.auth_ua_keys && row.auth_ua_keys.length)" class="app-muted">公共池</span>
            </template>
          </el-table-column>
          <el-table-column prop="forward_ua" label="请求 UA（空=随请求者）" min-width="120" />
          <el-table-column label="启用" width="70" align="center">
            <template #default="{ row }">
              <el-switch :model-value="row.enabled" disabled size="small" />
            </template>
          </el-table-column>
          <el-table-column prop="remark" label="备注" min-width="100" />
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button size="small" @click="openEdit(row)">编辑</el-button>
              <el-button size="small" type="danger" @click="del(row.id)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <!-- 限流状态 -->
        <div style="margin-top: 20px; margin-bottom: 8px; font-weight: 600; font-size: 14px;">限流状态</div>
        <div v-if="states.length === 0" class="app-muted" style="font-size: 13px;">暂无限流状态数据</div>
        <div v-for="st in states" :key="st.worker_id" style="margin-bottom: 12px; font-size: 13px;">
          <div style="margin-bottom: 4px;">
            <el-tag size="small" type="info" style="margin-right: 8px;">{{ st.worker_id }}</el-tag>
            来源: {{ st.keys_source }} &nbsp;|&nbsp; 密钥数: {{ st.key_count }} &nbsp;|&nbsp; 重置日: {{ st.reset_date }}
          </div>
          <div>
            <el-tag
              v-for="(grp, kid) in st.key_state"
              :key="kid"
              :type="grp.exhausted ? 'danger' : 'success'"
              size="small"
              style="margin: 2px;"
            >{{ kid }}: {{ grp.used }}/{{ grp.limit }}</el-tag>
          </div>
        </div>
      </el-card>

      <!-- 编辑/新增弹窗 -->
      <el-dialog v-model="showEdit" :title="editId ? '编辑密钥' : '新增密钥'" width="520px" destroy-on-close>
        <el-form label-width="130px" label-position="right" size="small">
          <el-form-item label="key_id">
            <el-input v-model="form.key_id" :disabled="!!editId" placeholder="密钥唯一标识" />
          </el-form-item>
          <el-form-item label="App ID">
            <el-input v-model="form.app_id" placeholder="应用 App ID" />
          </el-form-item>
          <el-form-item label="App Secret">
            <el-input v-model="form.app_secret" type="password" show-password placeholder="留空保留旧值" />
          </el-form-item>
          <el-form-item label="授权 UA">
            <el-checkbox-group v-model="form.auth_ua_keys">
              <el-checkbox v-for="ua in uaKeys" :key="ua" :label="ua">{{ ua }}</el-checkbox>
            </el-checkbox-group>
          </el-form-item>
          <el-form-item label="转发 UA">
            <el-input v-model="form.forward_ua" placeholder="请求时使用的 User-Agent（空=随请求者）" />
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="form.remark" />
          </el-form-item>
          <el-form-item label="启用">
            <el-switch v-model="form.enabled" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="showEdit = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
        </template>
      </el-dialog>

      <!-- JSON 导入弹窗 -->
      <el-dialog v-model="showImport" title="JSON 批量导入" width="480px" destroy-on-close>
        <el-form label-width="80px" size="small">
          <el-form-item label="JSON 内容">
            <el-input v-model="importText" type="textarea" :rows="8" placeholder='[{"key_id":"...","app_id":"...","app_secret":"..."}]' />
          </el-form-item>
          <el-form-item label="">
            <el-checkbox v-model="replaceAll">全量替换（清空现有密钥）</el-checkbox>
          </el-form-item>
        </el-form>
        <el-alert v-if="importError" :title="importError" type="error" :closable="false" style="margin-top: 8px;" />
        <template #footer>
          <el-button @click="showImport = false">取消</el-button>
          <el-button type="primary" :loading="importing" @click="doImport">导入</el-button>
        </template>
      </el-dialog>
    </fieldset>

    <SignKeyPool />
    <UserAllowPool />
  </section>
</template>

<script>
import RustSecurityCrud from './RustSecurityCrud.vue'
import { reactive, ref, onMounted } from 'vue'
// 旧业务语义尚未在 Rust 实现：保留页面但阻止旧接口及误写请求
const apiV2 = async () => { throw new Error('当前 Rust 后端尚未实现此页面的业务契约') }
import SignKeyPool from './SignKeyPool.vue'
import UserAllowPool from './UserAllowPool.vue'

export default {
  name: 'KeyPool',
  components: { SignKeyPool, UserAllowPool, RustSecurityCrud },
  setup() {
    const items = ref([])
    const states = ref([])
    const uaKeys = ref([])
    const groups = ['search_anime', 'search_episodes', 'bangumi', 'comment', 'match']
    const msg = ref('')
    const updatedAt = ref('')

    const showEdit = ref(false)
    const saving = ref(false)
    const editId = ref(null)
    const form = reactive({
      key_id: '', app_id: '', app_secret: '',
      auth_ua_keys: [], forward_ua: '', remark: '', enabled: true
    })

    const showImport = ref(false)
    const importText = ref('')
    const replaceAll = ref(false)
    const importing = ref(false)
    const importError = ref('')

    const load = async () => {
      msg.value = ''
      try {
        const [res, stRes, uaRes] = await Promise.all([
          apiV2('/key-pool'),
          apiV2('/key-pool/states'),
          apiV2('/key-pool/ua-keys'),
        ])
        items.value = res.items || []
        states.value = stRes.states || []
        uaKeys.value = uaRes.ua_keys || []
        updatedAt.value = fmtTs(res.updated_at)
      } catch (e) { msg.value = e.message }
    }

    const openCreate = () => {
      editId.value = null
      Object.assign(form, { key_id: '', app_id: '', app_secret: '', auth_ua_keys: [], forward_ua: '', remark: '', enabled: true })
      showEdit.value = true
    }
    const openEdit = (row) => {
      editId.value = row.id
      Object.assign(form, { key_id: row.key_id, app_id: row.app_id, app_secret: '', auth_ua_keys: row.auth_ua_keys || [], forward_ua: row.forward_ua || '', remark: row.remark || '', enabled: row.enabled })
      showEdit.value = true
    }
    const submit = async () => {
      saving.value = true
      try {
        if (editId.value) {
          await apiV2(`/key-pool/${editId.value}`, { method: 'PUT', body: JSON.stringify(form) })
        } else {
          await apiV2('/key-pool', { method: 'POST', body: JSON.stringify(form) })
        }
        showEdit.value = false
        await load()
      } catch (e) { msg.value = e.message } finally { saving.value = false }
    }
    const toggle = async (id, val) => {
      try {
        await apiV2(`/key-pool/${id}/toggle`, { method: 'PUT', body: JSON.stringify({ enabled: val }) })
        await load()
      } catch (e) { msg.value = e.message }
    }
    const del = async (id) => {
      try {
        await apiV2(`/key-pool/${id}`, { method: 'DELETE' })
        await load()
      } catch (e) { msg.value = e.message }
    }
    const resync = async () => {
      try {
        await apiV2('/key-pool/resync', { method: 'POST' })
        await load()
      } catch (e) { msg.value = e.message }
    }
    const openImport = () => {
      importText.value = ''; importError.value = ''; replaceAll.value = false
      showImport.value = true
    }
    const doImport = async () => {
      importing.value = true; importError.value = ''
      try {
        await apiV2('/key-pool/import', { method: 'POST', body: JSON.stringify({ json: importText.value, replace_all: replaceAll.value }) })
        showImport.value = false
        await load()
      } catch (e) { importError.value = e.message } finally { importing.value = false }
    }
    const exportJson = async () => {
      try {
        const res = await apiV2('/key-pool')
        const blob = new Blob([JSON.stringify(res.items || [], null, 2)], { type: 'application/json' })
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'key-pool.json'; a.click()
      } catch (e) { msg.value = e.message }
    }
    const fmt = (v) => v || '—'
    const fmtTs = (ts) => ts ? new Date(ts).toLocaleString('zh-CN') : ''

    onMounted(load)
    return { items, states, uaKeys, groups, msg, updatedAt, showEdit, saving, editId, form,
      showImport, importText, replaceAll, importing, importError,
      load, openCreate, openEdit, submit, toggle, del, resync, openImport, doImport, exportJson, fmt, fmtTs }
  }
}
</script>
