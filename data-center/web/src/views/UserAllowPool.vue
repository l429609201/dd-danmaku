<template>
  <section>
    <RustSecurityCrud kind="user" />
    <p role="alert" class="contract-warning">Rust 当前单用户白名单不是本页的用户组；尚未实现用户组绑定、品牌标记及 wasm 混淆换算。 原功能保留，等待后端补齐；当前不发送旧接口请求。</p>
    <fieldset disabled style="border: 0; padding: 0; margin: 0; min-width: 0; opacity: .65">
  <div class="panel" style="margin-top: 20px;">
    <div class="panel-head">
      <h2 class="panel-title">用户允许名单池</h2>
      <button class="btn btn-primary" @click="openCreate">新增用户组</button>
    </div>
    <p class="hint">
      按客户端用户标识（请求头 <code>X-Ddd-User</code> 的值）过滤访问。
      在「UA 限流规则」编辑里为某个 UA 选择本组，即对该 UA 启用校验；<strong>不选则不校验</strong>。
      校验顺序：用户标识归属反解 → 用户名单 → 签名。
      认证类校验连续失败 5 次，将按「IP + 用户标识 + UA」拉黑 1 小时。
    </p>
    <div v-if="msg" class="tip">{{ msg }}</div>

    <table class="data-table">
      <thead><tr>
        <th>组ID</th><th>用户数</th><th>用户标识（前若干个）</th><th>归属校验</th><th>备注</th><th>启用</th><th>操作</th>
      </tr></thead>
      <tbody>
        <tr v-for="r in items" :key="r.id">
          <td class="key">{{ r.group_id }}</td>
          <td>{{ r.user_count }}</td>
          <td class="msg">{{ previewUsers(r.users) }}</td>
          <td>{{ r.brand_mark ? '✅ ' + r.brand_mark : '—' }}</td>
          <td>{{ r.remark || '—' }}</td>
          <td>{{ r.enabled ? '是' : '否' }}</td>
          <td class="actions">
            <button class="link" @click="openEdit(r)">编辑</button>
            <button class="link" @click="toggle(r)">{{ r.enabled ? '停用' : '启用' }}</button>
            <button class="link danger" @click="del(r.id)">删除</button>
          </td>
        </tr>
        <tr v-if="!items.length"><td colspan="7" class="empty">暂无用户组</td></tr>
      </tbody>
    </table>

    <!-- 新增/编辑弹窗 -->
    <div v-if="showEdit" class="modal-mask" @click.self="showEdit=false">
      <div class="modal">
        <div class="modal-header">
          <h2>{{ editId ? '编辑' : '新增' }}用户组</h2>
          <button class="modal-close" @click="showEdit=false">×</button>
        </div>
        <div class="form-item">
          <label>组ID（唯一标识）</label>
          <input v-model="form.group_id" class="input full" :disabled="!!editId" />
        </div>
        <div class="form-item">
          <label>允许的用户标识（每行一个，也可用逗号分隔）</label>
          <textarea v-model="form.usersText" class="input full" rows="8"
                    placeholder="a165fec177ff6c8dacad5a9379dd47f9..."></textarea>
          <p class="hint">
            当前 {{ parsedCount }} 个。<strong>精确匹配</strong>，区分大小写。
            <strong>留空 = 不限制具体用户</strong>，放行所有通过归属校验的请求；
            只在需要精确到人时才填。
          </p>
          <p class="hint">
            ⚠️ 客户端上报的是 <strong>混淆后的值</strong>（非 Emby 原生用户 ID）。
            填 Emby 原生 ID 无法匹配，请用下方工具换算。
          </p>
        </div>
        <div class="form-item">
          <label>混淆值换算工具（把 Emby 原生用户 ID 转成客户端实际上报的值）</label>
          <textarea v-model="obfInput" class="input full" rows="3"
                    placeholder="粘贴 Emby 原生用户 ID，每行一个"></textarea>
          <div style="margin-top:8px; display:flex; gap:8px; align-items:center">
            <button class="btn" :disabled="obfBusy || !obfInput.trim()" @click="doObfuscate">
              {{ obfBusy ? '换算中...' : '换算' }}
            </button>
            <button class="btn" :disabled="!obfResult.length" @click="appendObfToUsers">
              追加到上方名单
            </button>
          </div>
          <p class="hint" v-if="obfError" style="color:#e5534b">{{ obfError }}</p>
          <p class="hint" v-if="obfResult.length">
            已换算 {{ obfResult.length }} 个（需先填好本组的品牌标记与混淆密钥）
          </p>
        </div>
        <div class="form-item">
          <label>归属校验（两项均填才启用；对 <code>X-Ddd-User</code> 做 XOR 反解识别）</label>
          <input v-model="form.brand_mark" class="input full" placeholder="品牌标记，如 misaka10876" />
          <input v-model="form.obf_key" class="input full" style="margin-top:8px"
                 placeholder="混淆密钥，如 misaka_danmu_server" />
          <p class="hint">
            客户端上报的 <code>X-Ddd-User</code> 即弹幕库生成的实例 ID，反解出品牌标记前缀才放行。
            两项必须与<strong>生成方</strong>（弹幕库配置 / <code>wasm-sign/assembly/config.ts</code>）
            <strong>完全一致</strong>，否则反解失败、请求全被拒。
            仅作归属识别，<strong>不能替代签名验证</strong>。留空则不校验归属。
          </p>
        </div>
        <div class="form-item"><label>备注</label><input v-model="form.remark" class="input full" /></div>
        <label class="chk"><input type="checkbox" v-model="form.enabled" /> 启用</label>
        <div class="modal-actions">
          <button class="btn" @click="showEdit=false">取消</button>
          <button class="btn btn-primary" :disabled="saving" @click="submit">{{ saving ? '提交中...' : '确认' }}</button>
        </div>
      </div>
    </div>
  </div>
    </fieldset>
  </section>
</template>

<script>
import RustSecurityCrud from './RustSecurityCrud.vue'
import { computed, reactive, ref, onMounted } from 'vue'
// 旧业务语义尚未在 Rust 实现：保留页面但阻止旧接口及误写请求。
const apiV2 = async () => { throw new Error('当前 Rust 后端尚未实现此页面的业务契约') }

export default {
  components: { RustSecurityCrud },
  name: 'UserAllowPool',
  setup() {
    const items = ref([])
    const msg = ref('')
    const showEdit = ref(false)
    const saving = ref(false)
    const editId = ref(null)
    // usersText 为文本域原文，提交时切分为数组（后端也会再规范化一次）
    const form = reactive({ group_id: '', usersText: '', brand_mark: '', obf_key: '', remark: '', enabled: true })

    // 把文本域内容切成用户名数组：支持换行与逗号混用，去空去重
    const parseUsers = (text) => {
      const raw = String(text || '').replace(/,/g, '\n').split('\n')
      const out = []
      const seen = new Set()
      for (const item of raw) {
        const v = item.trim()
        if (!v || seen.has(v)) continue
        seen.add(v)
        out.push(v)
      }
      return out
    }
    const parsedCount = computed(() => parseUsers(form.usersText).length)

    // ===== 混淆值换算：客户端上报的是 wasm 混淆值，手工算不现实，走后端换算 =====
    const obfInput = ref('')
    const obfResult = ref([])
    const obfError = ref('')
    const obfBusy = ref(false)

    const doObfuscate = async () => {
      obfError.value = ''
      obfResult.value = []
      if (!form.brand_mark || !form.obf_key) {
        obfError.value = '请先填写下方的品牌标记与混淆密钥（两者都必填）'
        return
      }
      obfBusy.value = true
      try {
        const s = await apiV2('/user-allow-pool/obfuscate', {
          method: 'POST',
          body: {
            user_ids: parseUsers(obfInput.value),
            brand_mark: form.brand_mark,
            obf_key: form.obf_key,
          },
        })
        obfResult.value = (s.data && s.data.items) || []
      } catch (e) {
        obfError.value = e.message
      } finally {
        obfBusy.value = false
      }
    }

    // 把换算结果并入名单文本域（parseUsers 会去重，重复追加无副作用）
    const appendObfToUsers = () => {
      const add = obfResult.value.map(x => x.obfuscated).filter(Boolean)
      if (!add.length) return
      const merged = parseUsers(form.usersText + '\n' + add.join('\n'))
      form.usersText = merged.join('\n')
      obfInput.value = ''
      obfResult.value = []
    }

    // 列表里只展示前 5 个，避免长名单撑破表格
    const previewUsers = (users) => {
      const arr = Array.isArray(users) ? users : []
      if (!arr.length) return '—'
      const head = arr.slice(0, 5).join(', ')
      return arr.length > 5 ? `${head} …(共 ${arr.length})` : head
    }

    const load = async () => {
      try {
        const s = await apiV2('/user-allow-pool')
        items.value = (s.data && s.data.items) || []
      } catch (e) { msg.value = e.message }
    }

    const resetForm = () => {
      form.group_id = ''; form.usersText = ''
      form.brand_mark = ''; form.obf_key = ''
      form.remark = ''; form.enabled = true
      // 换算工具的临时状态一并清空，避免串到下一次编辑
      obfInput.value = ''; obfResult.value = []; obfError.value = ''
    }
    const openCreate = () => { editId.value = null; resetForm(); showEdit.value = true }
    const openEdit = (r) => {
      editId.value = r.id
      form.group_id = r.group_id
      form.usersText = (Array.isArray(r.users) ? r.users : []).join('\n')
      form.brand_mark = r.brand_mark || ''
      form.obf_key = r.obf_key || ''
      form.remark = r.remark || ''
      form.enabled = r.enabled
      showEdit.value = true
    }

    const submit = async () => {
      if (!form.group_id) { msg.value = '请填写组ID'; return }
      saving.value = true
      try {
        const users = parseUsers(form.usersText)
        if (editId.value) {
          const body = { users,
            brand_mark: form.brand_mark || undefined,
            obf_key: form.obf_key || undefined,
            remark: form.remark, enabled: form.enabled }
          const res = await apiV2(`/user-allow-pool/${editId.value}`, { method: 'PUT', body })
          msg.value = res.message || '更新成功'
        } else {
          const body = { group_id: form.group_id, users,
            brand_mark: form.brand_mark || undefined,
            obf_key: form.obf_key || undefined,
            remark: form.remark, enabled: form.enabled }
          const res = await apiV2('/user-allow-pool', { method: 'POST', body })
          msg.value = res.message || '创建成功'
        }
        showEdit.value = false
        load()
      } catch (e) { msg.value = e.message }
      finally { saving.value = false }
    }
    const toggle = async (r) => {
      try { await apiV2(`/user-allow-pool/${r.id}`, { method: 'PUT', body: { enabled: !r.enabled } }); load() }
      catch (e) { msg.value = e.message }
    }
    const del = async (id) => {
      if (!confirm('确认删除该用户组？绑定它的 UA 将不再校验用户名。')) return
      try { const res = await apiV2(`/user-allow-pool/${id}`, { method: 'DELETE' }); msg.value = res.message || '已删除'; load() }
      catch (e) { msg.value = e.message }
    }

    onMounted(load)
    return { items, msg, showEdit, saving, editId, form, parsedCount,
      obfInput, obfResult, obfError, obfBusy, doObfuscate, appendObfToUsers,
      previewUsers, openCreate, openEdit, submit, toggle, del }
  }
}
</script>

<style scoped>
.panel { background: var(--color-bg); border-radius: 10px; padding: 18px; box-shadow: var(--shadow-sm); margin-bottom: 24px; border: 1px solid var(--color-border-light); }
.panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.panel-title { font-size: 16px; color: var(--color-text); }
.hint { color: var(--color-text-secondary); font-size: 12px; margin-bottom: 10px; }
.hint code { background: var(--color-bg-page); padding: 1px 5px; border-radius: 3px; font-size: 11px; }
.tip { background: color-mix(in srgb, var(--color-primary) 8%, transparent); border: 1px solid color-mix(in srgb, var(--color-primary) 25%, transparent); padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; color: var(--color-primary); font-size: 13px; }
.data-table { width: 100%; border-collapse: collapse; }
.data-table th, .data-table td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--color-border-lighter); font-size: 13px; }
.data-table th { color: var(--color-text-secondary); font-weight: 500; }
.key { font-family: monospace; font-size: 12px; }
.msg { color: var(--color-text-secondary); font-size: 12px; max-width: 320px; word-break: break-all; }
.actions { display: flex; gap: 8px; }
.link { background: none; border: none; color: var(--color-primary); cursor: pointer; font-size: 13px; }
.link.danger { color: var(--color-danger); }
.empty { text-align: center; color: var(--color-text-disabled); padding: 20px; }
.btn { padding: 8px 16px; border: 1px solid var(--color-border); background: var(--color-bg); color: var(--color-text); border-radius: 6px; cursor: pointer; }
.btn:disabled { opacity: .6; cursor: not-allowed; }
.btn-primary { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.input { padding: 8px 12px; border: 1px solid var(--color-border); border-radius: 6px; font-family: inherit; font-size: 13px; background: var(--color-bg); color: var(--color-text); }
.input.full { width: 100%; box-sizing: border-box; }
textarea.input { resize: vertical; font-family: monospace; }
.chk { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--color-text-secondary); margin-bottom: 14px; }
.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { width: 520px; max-width: 92vw; background: var(--color-bg-elevated); border-radius: 12px; padding: 20px; border: 1px solid var(--color-border); }
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.modal-close { border: none; background: none; font-size: 22px; color: var(--color-text-secondary); cursor: pointer; }
.form-item { margin-bottom: 14px; }
.form-item label { display: block; margin-bottom: 6px; color: var(--color-text-secondary); font-size: 13px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
</style>
