<script setup>
import { computed, onMounted, ref } from 'vue'
import { api } from './api.js'

const rows = ref([]), loading = ref(false), saving = ref(false), error = ref('')
const filters = ref({ namespace: '', key: '', keyword: '' }), page = ref(1), pageSize = 20
const dialog = ref(false), editing = ref(false), form = ref({ Namespace: '', Key: '', Value: '', Type: 'string', Description: '' })
const filtered = computed(() => rows.value.filter(x => (!filters.value.namespace || x.Namespace === filters.value.namespace) && (!filters.value.key || x.Key === filters.value.key) && (!filters.value.keyword || JSON.stringify(x).toLowerCase().includes(filters.value.keyword.toLowerCase()))))
const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))
async function load() { loading.value = true; error.value = ''; try { const data = await api.parameters(filters.value); rows.value = data?.DataList || data?.dataList || data?.items || []; page.value = 1 } catch (e) { error.value = e.message } finally { loading.value = false } }
function openCreate() { editing.value = false; form.value = { Namespace: filters.value.namespace || 'default', Key: '', Value: '', Type: 'string', Description: '' }; dialog.value = true }
function openEdit(row) { editing.value = true; form.value = { Namespace: row.Namespace, Key: row.Key, Value: row.Value, Type: row.Type, Description: row.Description || '' }; dialog.value = true }
async function submit() {
  if (!form.value.Namespace || !form.value.Key || saving.value) return
  saving.value = true; error.value = ''
  try {
    let overwrite = false
    if (!editing.value) {
      const same = await api.parameters({ namespace: form.value.Namespace, key: form.value.Key })
      const found = same?.Data || same?.data || same?.item
      if (found) {
        if (!window.confirm('同键参数已存在，是否覆盖？')) return
        overwrite = true
      }
    }
    // 创建确认覆盖后改走更新接口，避免把“确认覆盖”误报成重复创建失败。
    const data = { ...form.value }
    await (editing.value || overwrite ? api.updateParameter(data) : api.saveParameter(data))
    dialog.value = false; await load()
  } catch (e) { error.value = e.message } finally { saving.value = false }
}
async function remove(row) { if (!window.confirm(`确认删除参数“${row.Key}”？`)) return; try { await api.deleteParameter({ Namespace: row.Namespace, Key: row.Key }); await load() } catch (e) { error.value = e.message } }
onMounted(load)
</script>
<template>
  <section class="panel"><el-card shadow="never" v-loading="loading"><template #header><div class="panel-head"><span>持久化参数</span><el-button type="primary" @click="openCreate">新建参数</el-button></div></template>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <div class="toolbar"><el-input v-model="filters.namespace" placeholder="Namespace" clearable /><el-input v-model="filters.key" placeholder="Key" clearable /><el-input v-model="filters.keyword" placeholder="关键词" clearable @keyup.enter="load" /><el-button @click="load">查询</el-button></div>
    <el-table :data="paged" stripe><el-table-column prop="Namespace" label="Namespace" /><el-table-column prop="Key" label="Key" /><el-table-column prop="Type" label="类型" width="110" /><el-table-column prop="Value" label="值"><template #default="{ row }"><span class="truncate">{{ row.Value }}</span></template></el-table-column><el-table-column label="操作" width="150"><template #default="{ row }"><el-button link @click="openEdit(row)">编辑</el-button><el-button link type="danger" @click="remove(row)">删除</el-button></template></el-table-column></el-table>
    <el-pagination v-model:current-page="page" :page-size="pageSize" layout="total, prev, pager, next" :total="filtered.length" />
  </el-card>
  <el-dialog v-model="dialog" :title="editing ? '编辑参数' : '新建参数'" width="560px"><el-form label-position="top"><el-form-item label="Namespace"><el-input v-model="form.Namespace" :disabled="editing" maxlength="256" /></el-form-item><el-form-item label="Key"><el-input v-model="form.Key" :disabled="editing" maxlength="512" /></el-form-item><el-form-item label="类型"><el-input v-model="form.Type" maxlength="32" /></el-form-item><el-form-item label="值"><el-input v-model="form.Value" type="textarea" :rows="6" maxlength="262144" show-word-limit /></el-form-item><el-form-item label="说明"><el-input v-model="form.Description" maxlength="2048" /></el-form-item></el-form><template #footer><el-button @click="dialog = false">取消</el-button><el-button type="primary" :loading="saving" @click="submit">保存</el-button></template></el-dialog>
  </section>
</template>
<style scoped>.panel-head,.toolbar{display:flex;align-items:center;gap:10px}.panel-head{justify-content:space-between}.toolbar{margin-bottom:14px}.toolbar .el-input{max-width:220px}.truncate{display:block;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.el-pagination{margin-top:16px;justify-content:flex-end}</style>
