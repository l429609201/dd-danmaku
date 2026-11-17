// 独立回归：隔离组件依赖与网络，验证未知/API 模式不触发 R2 请求。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { parse, compileTemplate, compileScript } from '@vue/compiler-sfc'

const source = await readFile(new URL('../src/views/CommentStore.vue', import.meta.url), 'utf8')
const dashboard = await readFile(new URL('../src/views/Dashboard.vue', import.meta.url), 'utf8')

function component(mode, capability = false, failMode = false) {
  const descriptor = parse(source).descriptor
  const calls = [], timers = [], mounted = []
  const context = {
    ref: value => ({ value }), computed: get => ({ get value() { return get() } }),
    onMounted: callback => mounted.push(callback), onUnmounted() {}, Pager: {},
    getCacheConfig: async () => { if (failMode) throw new Error('模式读取失败'); return { run_mode: mode } },
    apiV2: async path => {
      calls.push(path)
      if (path.endsWith('/stats')) return { data: { capabilities: { r2: capability }, r2_task: { running: true } } }
      return { items: [], total: 0 }
    },
    setInterval: callback => { timers.push(callback); return timers.length }, clearInterval() {},
  }
  vm.createContext(context)
  const script = descriptor.script.content.replace(/^import .*$/gm, '').replace('export default', 'globalThis.component =')
  vm.runInContext(script, context)
  const state = context.component.setup()
  return { state, calls, timers, mount: async () => { await mounted[0](); await new Promise(resolve => setImmediate(resolve)) } }
}

for (const mode of [undefined, null, '', 'api', 'Worker', 'unknown']) {
  test(`模式 ${String(mode)} 隐藏 R2，能力或旧任务不能绕过守卫`, async () => {
    const c = component(mode, true)
    assert.equal(c.state.isWorkerMode.value, false)
    await c.mount()
    assert.equal(c.state.isWorkerMode.value, false)
    await c.state.saveR2Control(); await c.state.startR2Task('scan'); await c.state.startR2Task('sync')
    assert.equal(c.timers.length, 0)
    assert.equal(c.calls.some(path => path.includes('/r2-')), false)
  })
}

test('模式请求失败默认隐藏 R2，仍加载本地存储', async () => {
  const c = component('worker', true, true)
  await c.mount()
  assert.equal(c.state.isWorkerMode.value, false)
  assert.equal(c.calls.length, 2)
  assert.equal(c.timers.length, 0)
})

test('Worker 显示入口，但未实现能力仍禁用且不恢复轮询', async () => {
  const c = component('worker')
  assert.equal(c.state.isWorkerMode.value, false)
  await c.mount()
  assert.equal(c.state.isWorkerMode.value, true)
  assert.equal(c.state.supports('r2'), false)
  await c.state.saveR2Control(); await c.state.startR2Task('scan')
  assert.equal(c.timers.length, 0)
  assert.equal(c.calls.some(path => path.includes('/r2-')), false)
})

test('只有 Worker 且能力明确可用时才恢复 R2 轮询', async () => {
  const c = component('worker', true)
  await c.mount()
  assert.equal(c.timers.length, 1)
  await c.timers[0]()
  assert.equal(c.calls.includes('/comment-store/r2-task'), true)
})

test('组件 SFC 编译通过且 R2 面板在模式条件之下', () => {
  for (const [filename, text] of [['CommentStore.vue', source], ['Dashboard.vue', dashboard]]) {
    const { descriptor, errors } = parse(text, { filename })
    assert.deepEqual(errors, [])
    compileScript(descriptor, { id: filename })
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: filename }).errors, [])
  }
  assert.match(source, /<div v-if="isWorkerMode" class="panel">\s*<h2 class="panel-title">R2/)
  assert.match(dashboard, /<span v-if="isWorkerMode"> \/ R2/)
  assert.match(dashboard, /isWorkerMode\.value \? \[build\('R2'/)
})
