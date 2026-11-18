<template>
  <section>
    <RustSecurityCrud kind="user" />

    <!-- 旧 Worker 用户允许名单池：Rust 新模型已在上方；保留旧面板便于对照，待后端补齐后移除 -->
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="Rust 当前单用户白名单不是本页的用户组；尚未实现用户组绑定、品牌标记及 wasm 混淆换算。 原功能保留，等待后端补齐；当前不发送旧接口请求。"
      style="margin: 12px 0;"
    />

    <fieldset disabled style="border: 0; padding: 0; margin: 0; min-width: 0; opacity: .65">
      <el-card style="margin-bottom: 16px;">
        <template #header>
          <div class="app-toolbar">
            <span style="font-weight: 600;">用户允许名单池</span>
            <el-button size="small" @click="openCreate">新增用户组</el-button>
            <el-button size="small" @click="load">刷新</el-button>
          </div>
        </template>

        <el-alert
          type="info"
          :closable="false"
          title="按客户端用户标识（请求头 x-bda-user 的值）过滤访问。认证类校验连续失败 5 次，将按 IP+用户名组合加入临时黑名单。"
          style="margin-bottom: 12px;"
        />

        <el-alert v-if="msg" :title="msg" type="info" :closable="false" style="margin-bottom: 12px;" />

        <el-table :data="items" size="small" border stripe>
          <el-table-column prop="group_id" label="组 ID" width="140" />
          <el-table-column label="用户数" width="80" align="center">
            <template #default="{ row }">{{ (row.users || []).length }}</template>
          </el-table-column>
          <el-table-column label="用户标识（前若干个）" min-width="180">
            <template #default="{ row }">
              <el-tag v-for="u in previewUsers(row.users)" :key="u" size="small" style="margin: 2px;">{{ u }}</el-tag>
              <span v-if="(row.users || []).length > 5" class="app-muted" style="font-size: 12px; margin-left: 4px;">共 {{ row.users.length }} 个</span>
            </template>
          </el-table-column>
          <el-table-column prop="brand_mark" label="归属校验" width="120" />
          <el-table-column prop="remark" label="备注" min-width="100" />
          <el-table-column label="启用" width="70" align="center">
            <template #default="{ row }">
              <el-switch :model-value="row.enabled" disabled size="small" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button size="small" @click="openEdit(row)">编辑</el-button>
              <el-button size="small" type="danger" @click="del(row.id)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- 编辑/新增弹窗 -->
      <el-dialog v-model="showEdit" :title="editId ? '编辑用户组' : '新增用户组'" width="560px" destroy-on-close>
        <el-form label-width="100px" label-position="right" size="small">
          <el-form-item label="组 ID">
            <el-input v-model="form.group_id" :disabled="!!editId" placeholder="用户组唯一标识" />
          </el-form-item>
          <el-form-item label="用户列表">
            <el-input
              v-model="form.usersText"
              type="textarea"
              :rows="6"
              placeholder="每行一个用户标识"
            />
            <div class="app-muted" style="font-size: 12px; margin-top: 4px;">共 {{ parsedCount }} 个用户</div>
          </el-form-item>

          <!-- 混淆换算工具 -->
          <el-form-item label="混淆换算">
            <div style="width: 100%;">
              <el-input
                v-model="obfInput"
                type="textarea"
                :rows="3"
                placeholder="输入明文用户标识（每行一个），换算后追加到用户列表"
              />
              <div style="margin-top: 6px; display: flex; gap: 6px; align-items: center;">
                <el-button size="small" :loading="obfBusy" @click="doObfuscate">换算</el-button>
                <el-button size="small" :disabled="!obfResult" @click="appendObfToUsers">追加到列表</el-button>
                <span v-if="obfError" style="color: var(--el-color-danger); font-size: 12px;">{{ obfError }}</span>
              </div>
              <el-input v-if="obfResult" v-model="obfResult" type="textarea" :rows="3" readonly style="margin-top: 6px;" />
            </div>
          </el-form-item>

          <el-form-item label="品牌标记">
            <el-input v-model="form.brand_mark" placeholder="品牌标记（可选）" />
          </el-form-item>
          <el-form-item label="混淆密钥">
            <el-input v-model="form.obf_key" type="password" show-password placeholder="留空保留旧值" />
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
    </fieldset>
  </section>
</template>

<script>
import RustSecurityCrud from './RustSecurityCrud.vue'
import { reactive, ref, computed, onMounted } from 'vue'
// 旧业务语义尚未在 Rust 实现：保留页面但阻止旧接口及误写请求
const apiV2 = async () => { throw new Error('当前 Rust 后端尚未实现此页面的业务契约') }

export default {
  name: 'UserAllowPool',
  components: { RustSecurityCrud },
  setup() {
    const items = ref([])
    const msg = ref('')
    const showEdit = ref(false)
    const saving = ref(false)
    const editId = ref(null)
    const form = reactive({ group_id: '', usersText: '', brand_mark: '', obf_key: '', remark: '', enabled: true })
    const obfInput = ref('')
    const obfResult = ref('')
    const obfError = ref('')
    const obfBusy = ref(false)

    const parseUsers = (text) =>
      text.split('\n').map(l => l.trim()).filter(Boolean)

    const parsedCount = computed(() => parseUsers(form.usersText).length)

    const previewUsers = (users) => (users || []).slice(0, 5)

    const doObfuscate = async () => {
      obfBusy.value = true; obfError.value = ''; obfResult.value = ''
      try {
        const res = await apiV2('/user-allow-pool/obfuscate', {
          method: 'POST',
          body: JSON.stringify({ users: parseUsers(obfInput.value), obf_key: form.obf_key })
        })
        obfResult.value = (res.obfuscated || []).join('\n')
      } catch (e) { obfError.value = e.message } finally { obfBusy.value = false }
    }

    const appendObfToUsers = () => {
      if (!obfResult.value) return
      const existing = form.usersText.endsWith('\n') ? form.usersText : (form.usersText ? form.usersText + '\n' : '')
      form.usersText = existing + obfResult.value
      obfResult.value = ''
      obfInput.value = ''
    }

    const load = async () => {
      msg.value = ''
      try {
        const res = await apiV2('/user-allow-pool')
        items.value = res.items || []
      } catch (e) { msg.value = e.message }
    }

    const resetForm = () => {
      Object.assign(form, { group_id: '', usersText: '', brand_mark: '', obf_key: '', remark: '', enabled: true })
      obfInput.value = ''; obfResult.value = ''; obfError.value = ''
    }

    const openCreate = () => {
      editId.value = null
      resetForm()
      showEdit.value = true
    }
    const openEdit = (row) => {
      editId.value = row.id
      Object.assign(form, {
        group_id: row.group_id,
        usersText: (row.users || []).join('\n'),
        brand_mark: row.brand_mark || '',
        obf_key: '',
        remark: row.remark || '',
        enabled: row.enabled
      })
      obfInput.value = ''; obfResult.value = ''; obfError.value = ''
      showEdit.value = true
    }
    const submit = async () => {
      saving.value = true
      try {
        const payload = { ...form, users: parseUsers(form.usersText) }
        if (editId.value) {
          await apiV2(`/user-allow-pool/${editId.value}`, { method: 'PUT', body: JSON.stringify(payload) })
        } else {
          await apiV2('/user-allow-pool', { method: 'POST', body: JSON.stringify(payload) })
        }
        showEdit.value = false
        await load()
      } catch (e) { msg.value = e.message } finally { saving.value = false }
    }
    const toggle = async (id, val) => {
      try {
        await apiV2(`/user-allow-pool/${id}/toggle`, { method: 'PUT', body: JSON.stringify({ enabled: val }) })
        await load()
      } catch (e) { msg.value = e.message }
    }
    const del = async (id) => {
      try {
        await apiV2(`/user-allow-pool/${id}`, { method: 'DELETE' })
        await load()
      } catch (e) { msg.value = e.message }
    }

    onMounted(load)
    return {
      items, msg, showEdit, saving, editId, form, obfInput, obfResult, obfError, obfBusy,
      parsedCount, previewUsers, doObfuscate, appendObfToUsers,
      load, resetForm, openCreate, openEdit, submit, toggle, del
    }
  }
}
</script>
