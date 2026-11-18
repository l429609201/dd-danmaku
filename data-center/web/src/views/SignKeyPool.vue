<template>
  <section>
    <RustSecurityCrud kind="sign" />

    <!-- 旧 Worker 签名密钥池面板：Rust 新模型已在上方；保留旧面板便于对照，待后端补齐后移除 -->
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="Rust 当前签名密钥模型尚未实现本页的 wasm 密钥组、UA 绑定、随机生成与明文复制契约。 原功能保留，等待后端补齐；当前不发送旧接口请求。"
      style="margin: 12px 0;"
    />

    <fieldset disabled style="border: 0; padding: 0; margin: 0; min-width: 0; opacity: .65">
      <el-card style="margin-bottom: 16px;">
        <template #header>
          <div class="app-toolbar">
            <span style="font-weight: 600;">签名密钥池</span>
            <el-button size="small" @click="openCreate">新增密钥组</el-button>
            <el-button size="small" @click="load">刷新</el-button>
          </div>
        </template>

        <el-alert
          type="info"
          :closable="false"
          title="客户端请求签名验证密钥。每组 secret 需与内置该密钥、独立编译的 ede.js/sign.wasm 一致。在「UA 限流规则」编辑里为某个 UA 选择本组，即对该 UA 启用签名验证。"
          style="margin-bottom: 12px;"
        />

        <el-alert v-if="msg" :title="msg" type="info" :closable="false" style="margin-bottom: 12px;" />

        <el-table :data="items" size="small" border stripe>
          <el-table-column prop="group_id" label="组 ID" width="140" />
          <el-table-column label="密钥" min-width="140">
            <template #default>
              <span class="app-mono" style="font-size: 12px;">••••••••</span>
            </template>
          </el-table-column>
          <el-table-column prop="remark" label="备注" min-width="100" />
          <el-table-column label="启用" width="70" align="center">
            <template #default="{ row }">
              <el-switch :model-value="row.enabled" disabled size="small" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{ row }">
              <el-button size="small" @click="copyRowSecret(row.id)">复制密钥</el-button>
              <el-button size="small" @click="openEdit(row)">编辑</el-button>
              <el-button size="small" type="danger" @click="del(row.id)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- 编辑/新增弹窗 -->
      <el-dialog v-model="showEdit" :title="editId ? '编辑密钥组' : '新增密钥组'" width="460px" destroy-on-close>
        <el-form label-width="90px" label-position="right" size="small">
          <el-form-item label="组 ID">
            <el-input v-model="form.group_id" :disabled="!!editId" placeholder="密钥组唯一标识" />
          </el-form-item>
          <el-form-item label="签名密钥">
            <div style="display: flex; gap: 6px; width: 100%;">
              <el-input
                v-model="form.secret"
                :type="secretShow ? 'text' : 'password'"
                :show-password="!secretShow"
                placeholder="留空保留旧值"
                style="flex: 1;"
              />
              <el-button size="small" @click="genSecret">随机生成</el-button>
              <el-button size="small" @click="secretShow = !secretShow">{{ secretShow ? '隐藏' : '显示' }}</el-button>
              <el-button size="small" @click="copySecret">复制</el-button>
            </div>
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
import { reactive, ref, onMounted } from 'vue'
// 旧业务语义尚未在 Rust 实现：保留页面但阻止旧接口及误写请求
const apiV2 = async () => { throw new Error('当前 Rust 后端尚未实现此页面的业务契约') }

export default {
  name: 'SignKeyPool',
  components: { RustSecurityCrud },
  setup() {
    const items = ref([])
    const msg = ref('')
    const showEdit = ref(false)
    const saving = ref(false)
    const editId = ref(null)
    const secretShow = ref(false)
    const form = reactive({ group_id: '', secret: '', remark: '', enabled: true })

    const load = async () => {
      msg.value = ''
      try {
        const res = await apiV2('/sign-key-pool')
        items.value = res.items || []
      } catch (e) { msg.value = e.message }
    }
    const genSecret = async () => {
      try {
        const res = await apiV2('/sign-key-pool/gen', { method: 'POST' })
        form.secret = res.secret || ''
      } catch (e) { msg.value = e.message }
    }
    const copySecret = () => {
      if (form.secret) navigator.clipboard.writeText(form.secret).catch(() => {})
    }
    const copyRowSecret = async (id) => {
      try {
        const res = await apiV2(`/sign-key-pool/${id}/secret`)
        await navigator.clipboard.writeText(res.secret || '')
      } catch (e) { msg.value = e.message }
    }
    const openCreate = () => {
      editId.value = null
      Object.assign(form, { group_id: '', secret: '', remark: '', enabled: true })
      secretShow.value = false
      showEdit.value = true
    }
    const openEdit = (row) => {
      editId.value = row.id
      Object.assign(form, { group_id: row.group_id, secret: '', remark: row.remark || '', enabled: row.enabled })
      secretShow.value = false
      showEdit.value = true
    }
    const submit = async () => {
      saving.value = true
      try {
        if (editId.value) {
          await apiV2(`/sign-key-pool/${editId.value}`, { method: 'PUT', body: JSON.stringify(form) })
        } else {
          await apiV2('/sign-key-pool', { method: 'POST', body: JSON.stringify(form) })
        }
        showEdit.value = false
        await load()
      } catch (e) { msg.value = e.message } finally { saving.value = false }
    }
    const toggle = async (id, val) => {
      try {
        await apiV2(`/sign-key-pool/${id}/toggle`, { method: 'PUT', body: JSON.stringify({ enabled: val }) })
        await load()
      } catch (e) { msg.value = e.message }
    }
    const del = async (id) => {
      try {
        await apiV2(`/sign-key-pool/${id}`, { method: 'DELETE' })
        await load()
      } catch (e) { msg.value = e.message }
    }

    onMounted(load)
    return { items, msg, showEdit, saving, editId, secretShow, form,
      load, genSecret, copySecret, copyRowSecret, openCreate, openEdit, submit, toggle, del }
  }
}
</script>
