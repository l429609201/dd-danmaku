// 普通请求只消费新鲜缓存；stale 数据必须继续回源刷新。
export function classifyLocalCache(local) {
    if (!local?.hit || !local.body) return 'miss';
    return local.stale === true ? 'refresh' : 'serve';
}
