# -*- coding: utf-8 -*-
"""临时编辑脚本：前端 KeyPool 挂载用户名单池 + UaRules 加用户组/实例校验表单"""
import io

EDITS = []

# ---------- KeyPool.vue：挂载 UserAllowPool 组件 ----------
EDITS.append(('web/src/views/KeyPool.vue', [
    (
        """    <!-- 签名密钥池（客户端请求验签，按 UA 分组） -->
    <SignKeyPool />""",
        """    <!-- 签名密钥池（客户端请求验签，按 UA 分组） -->
    <SignKeyPool />

    <!-- 用户允许名单池（按 X-Ddd-User 过滤，UA 规则绑定） -->
    <UserAllowPool />""",
    ),
    (
        """import SignKeyPool from './SignKeyPool.vue'""",
        """import SignKeyPool from './SignKeyPool.vue'
import UserAllowPool from './UserAllowPool.vue'""",
    ),
    (
        """  components: { SignKeyPool },""",
        """  components: { SignKeyPool, UserAllowPool },""",
    ),
]))

# ---------- UaRules.vue：表格列 + 表单项 + 脚本 ----------
EDITS.append(('web/src/views/UaRules.vue', [
    # 表头：签名组后加 用户组 / 实例校验
    (
        """<th>路径限流</th><th>签名组</th><th>启用</th><th>操作</th>""",
        """<th>路径限流</th><th>签名组</th><th>用户组</th><th>实例校验</th><th>启用</th><th>操作</th>""",
    ),
    # 表格数据行
    (
        """          <td>{{ r.sign_group_id || '关' }}</td>""",
        """          <td>{{ r.sign_group_id || '关' }}</td>
          <td>{{ r.user_group_id || '关' }}</td>
          <td>{{ r.instance_brand_mark ? r.instance_brand_mark : '关' }}</td>""",
    ),
    # 表单：签名组下拉之后追加用户组下拉 + 实例校验两个输入框
    (
        """        <div class="form-item">
          <label>签名密钥组（选择即对该 UA 启用签名验证；不选=不启用）</label>
          <select v-model="form.sign_group_id" class="input full">
            <option value="">不启用</option>
            <option v-for="g in signGroups" :key="g.group_id" :value="g.group_id">
              {{ g.group_id }}{{ g.remark ? '（' + g.remark + '）' : '' }}
            </option>
          </select>
        </div>""",
        """        <div class="form-item">
          <label>签名密钥组（选择即对该 UA 启用签名验证；不选=不启用）</label>
          <select v-model="form.sign_group_id" class="input full">
            <option value="">不启用</option>
            <option v-for="g in signGroups" :key="g.group_id" :value="g.group_id">
              {{ g.group_id }}{{ g.remark ? '（' + g.remark + '）' : '' }}
            </option>
          </select>
        </div>
        <div class="form-item">
          <label>用户允许名单组（选择即校验 X-Ddd-User；不选=不校验）</label>
          <select v-model="form.user_group_id" class="input full">
            <option value="">不启用</option>
            <option v-for="g in userGroups" :key="g.group_id" :value="g.group_id">
              {{ g.group_id }}（{{ g.user_count }} 人{{ g.remark ? '，' + g.remark : '' }}）
            </option>
          </select>
        </div>
        <div class="form-item">
          <label>实例 ID 校验（两项都填才启用；对 X-Ddd-User 做 XOR 反解校验归属）</label>
          <input v-model="form.instance_brand_mark" class="input full"
                 placeholder="归属标记，如 misaka10876" />
          <input v-model="form.instance_obf_key" class="input full" style="margin-top:8px"
                 placeholder="混淆密钥，如 misaka_danmu_server" />
          <p class="hint">
            仅作<strong>归属识别</strong>（挡非该弹幕库的客户端），密钥公开可推算，不能替代签名验证。
            校验顺序：实例 ID → 用户名 → 签名，失败均返回 401。
          </p>
        </div>""",
    ),
    # 脚本：form 增加三字段
    (
        """    const form = reactive({ ua_key: '', user_agent: '', max_requests: 0, window_ms: 60000, path_limits: [], sign_group_id: '' })
    const signGroups = ref([])""",
        """    const form = reactive({ ua_key: '', user_agent: '', max_requests: 0, window_ms: 60000, path_limits: [],
      sign_group_id: '', user_group_id: '', instance_brand_mark: '', instance_obf_key: '' })
    const signGroups = ref([])
    const userGroups = ref([])""",
    ),
    # 脚本：加载用户组列表
    (
        """      } catch (e) { /* 忽略:签名池为空不影响 UA 编辑 */ }""",
        """      } catch (e) { /* 忽略:签名池为空不影响 UA 编辑 */ }
    }
    // 拉取用户允许名单组，供下拉选择
    const loadUserGroups = async () => {
      try {
        const res = await apiV2('/user-allow-pool')
        userGroups.value = (res.data && res.data.items) || []
      } catch (e) { /* 忽略:名单池为空不影响 UA 编辑 */ }""",
    ),
    # 脚本：resetForm 重置三字段
    (
        """      form.window_ms = 60000; form.path_limits = []; form.sign_group_id = ''""",
        """      form.window_ms = 60000; form.path_limits = []; form.sign_group_id = ''
      form.user_group_id = ''; form.instance_brand_mark = ''; form.instance_obf_key = ''""",
    ),
    # 脚本：openEdit 回填三字段
    (
        """      form.sign_group_id = r.sign_group_id || ''""",
        """      form.sign_group_id = r.sign_group_id || ''
      form.user_group_id = r.user_group_id || ''
      form.instance_brand_mark = r.instance_brand_mark || ''
      form.instance_obf_key = r.instance_obf_key || ''""",
    ),
    # 脚本：submit 提交三字段
    (
        """          sign_group_id: form.sign_group_id,""",
        """          sign_group_id: form.sign_group_id,
          user_group_id: form.user_group_id,
          instance_brand_mark: form.instance_brand_mark,
          instance_obf_key: form.instance_obf_key,""",
    ),
    # 脚本：onMounted 拉取用户组
    (
        """    onMounted(() => { load(); loadSignGroups() })""",
        """    onMounted(() => { load(); loadSignGroups(); loadUserGroups() })""",
    ),
    # 脚本：return 导出
    (
        """    return { items, total, page, pageSize, keyword, msg, showCreate, creating, editId, form, signGroups,""",
        """    return { items, total, page, pageSize, keyword, msg, showCreate, creating, editId, form, signGroups, userGroups,""",
    ),
]))


for path, pairs in EDITS:
    with io.open(path, encoding='utf-8') as f:
        src = f.read()
    ok = True
    for old, new in pairs:
        if old not in src:
            print('  MISS', path, '|', old.strip().splitlines()[0][:70])
            ok = False
            continue
        src = src.replace(old, new, 1)
    if ok:
        with io.open(path, 'w', encoding='utf-8', newline='\n') as f:
            f.write(src)
        print('  OK', path)
