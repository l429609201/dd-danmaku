import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { uiSessionScope } from './api.js'

const prefix = 'dd-admin-ui-v1:'
function storageKey(name) {
  try { return `${prefix}${uiSessionScope()}:${name}` } catch { return null }
}
function readState(name) {
  try {
    const key = storageKey(name)
    const value = key && JSON.parse(sessionStorage.getItem(key) || 'null')
    return value && Date.now() - value.at < 24 * 60 * 60 * 1000 ? value.data : null
  } catch { return null }
}
function writeState(name, data) {
  try {
    const key = storageKey(name)
    if (key) sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data }))
  } catch { /* 禁用存储或配额不足时仍保持内存编辑可用。 */ }
}

// KeepAlive 处理实例内切页，sessionStorage 补上 iframe 重挂载及同标签刷新。
export function useUiRef(name, initial, validate = () => true) {
  const owner = storageKey(name)
  const saved = readState(name)
  const state = ref(saved != null && validate(saved) ? saved : initial)
  watch(state, value => {
    if (owner && storageKey(name) === owner && validate(value)) writeState(name, value)
  }, { deep: true, flush: 'sync' })
  return state
}

export function useDetailsState(name) {
  const opened = useUiRef(name, {}, value => value && typeof value === 'object' && !Array.isArray(value))
  function isOpen(title, fallback = false) { return opened.value[title] ?? fallback }
  function toggle(title, event) {
    // 只记录用户产生的变化；恢复 DOM 的 toggle 不应改写其他对象的展开状态。
    const open = event.target.open
    if (opened.value[title] !== open) opened.value = { ...opened.value, [title]: open }
  }
  return { isOpen, toggle }
}

const memoryDrafts = new Map()
const dirtyStores = new Set()
let warningInstalled = false
export function useSafeDrafts(name, safe) {
  const entries = ref({})
  const owner = storageKey('draft-memory')
  let key = ''
  function persist() {
    if (!key || !owner || storageKey('draft-memory') !== owner) return
    memoryDrafts.set(key, { ...entries.value })
    // URL、自定义源、密钥等敏感字段仅保留内存，不进入浏览器存储。
    writeState(`draft:${key}`, Object.fromEntries(Object.entries(entries.value).filter(([id]) => safe(id))))
    if (Object.keys(entries.value).length) dirtyStores.add(key)
    else dirtyStores.delete(key)
  }
  function select(objectKey) {
    if (!owner || storageKey('draft-memory') !== owner) { entries.value = {}; key = ''; return }
    key = `${owner}:${name}:${objectKey}`
    const saved = readState(`draft:${key}`)
    const safeSaved = saved && typeof saved === 'object' && !Array.isArray(saved)
      ? Object.fromEntries(Object.entries(saved).filter(([id]) => safe(id))) : {}
    entries.value = { ...(memoryDrafts.get(key) || safeSaved) }
    if (Object.keys(entries.value).length) dirtyStores.add(key)
    else dirtyStores.delete(key)
  }
  function stage(id, value) { entries.value = { ...entries.value, [id]: value }; persist() }
  function acknowledge(id, value) {
    if (!Object.hasOwn(entries.value, id) || entries.value[id] !== value) return
    const next = { ...entries.value }; delete next[id]; entries.value = next; persist()
  }
  function acknowledgeAt(objectKey, id, value) {
    const target = `${owner}:${name}:${objectKey}`
    if (target === key) { acknowledge(id, value); return }
    if (!owner || storageKey('draft-memory') !== owner) return
    const saved = memoryDrafts.get(target)
    if (!saved || saved[id] !== value) return
    const next = { ...saved }; delete next[id]
    memoryDrafts.set(target, next)
    writeState(`draft:${target}`, Object.fromEntries(Object.entries(next).filter(([field]) => safe(field))))
    if (!Object.keys(next).length) dirtyStores.delete(target)
  }
  function discard() { entries.value = {}; persist() }
  if (!warningInstalled) {
    window.addEventListener('beforeunload', event => {
      const currentOwner = storageKey('draft-memory')
      if (!currentOwner || ![...dirtyStores].some(item => item.startsWith(`${currentOwner}:`))) return
      event.preventDefault(); event.returnValue = ''
    })
    warningInstalled = true
  }
  return { entries, count: computed(() => Object.keys(entries.value).length), select, stage, acknowledge, acknowledgeAt, discard }
}

// 使用 iframe 自己的滚动容器，不改动 Emby 外层 URL 或导航历史。
export function usePagePosition(active) {
  const positions = useUiRef('scroll-positions', {}, value => value && typeof value === 'object')
  let restoring = false, observer, timer, frame
  function save() {
    if (!restoring) positions.value = { ...positions.value, [active.value]: window.scrollY }
  }
  function stop() {
    restoring = false; observer?.disconnect(); clearTimeout(timer); cancelAnimationFrame(frame)
  }
  function restore() {
    stop()
    const y = positions.value[active.value] || 0
    restoring = true
    const apply = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        window.scrollTo(0, y)
        if (Math.abs(window.scrollY - y) < 2) stop()
      })
    }
    observer = new MutationObserver(apply)
    observer.observe(document.getElementById('app'), { childList: true, subtree: true })
    timer = setTimeout(stop, 10000); apply()
  }
  watch(active, restore, { flush: 'post' })
  window.addEventListener('scroll', save, { passive: true })
  window.addEventListener('pagehide', save)
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) window.addEventListener(event, stop, { passive: true })
  onBeforeUnmount(() => {
    save(); stop(); window.removeEventListener('scroll', save); window.removeEventListener('pagehide', save)
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) window.removeEventListener(event, stop)
  })
  return { restore }
}
