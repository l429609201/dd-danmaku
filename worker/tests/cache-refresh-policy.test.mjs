import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyLocalCache } from '../cache_refresh_policy.mjs';

test('新鲜本地缓存直接返回，stale 缓存继续回源刷新', () => {
    assert.equal(classifyLocalCache({ hit: true, body: '{}', stale: false }), 'serve');
    assert.equal(classifyLocalCache({ hit: true, body: '{}', stale: true }), 'refresh');
    assert.equal(classifyLocalCache({ hit: false, body: '{}' }), 'miss');
    assert.equal(classifyLocalCache(null), 'miss');
});

test('普通缓存阶段仅在 fresh 分支回填 Worker 内存', async () => {
    const source = await readFile(new URL('../cf_worker.js', import.meta.url), 'utf8');
    const start = source.indexOf('async function tryLocalApiCache');
    const end = source.indexOf('\nasync function tryEdgeCaches', start);
    const localCacheSource = source.slice(start, end);

    assert.ok(start >= 0 && end > start);
    assert.match(localCacheSource, /classifyLocalCache\(local\)/);
    assert.match(localCacheSource, /localPolicy === 'refresh'/);
    assert.match(localCacheSource, /localPolicy === 'serve'/);
    const refreshStart = localCacheSource.indexOf("localPolicy === 'refresh'");
    const serveStart = localCacheSource.indexOf("localPolicy === 'serve'");
    assert.equal(localCacheSource.slice(refreshStart, serveStart).includes('apiCache.set'), false);
})

test('429 兜底显式允许读取真正过期的本地缓存', async () => {
    const source = await readFile(new URL('../cf_worker.js', import.meta.url), 'utf8');
    const start = source.indexOf('async function tryPersistentRateLimitFallback');
    const end = source.indexOf('\nfunction finalizeUpstreamResponse', start);
    const fallbackSource = source.slice(start, end);

    assert.ok(start >= 0 && end > start);
    assert.match(fallbackSource, /allow_stale:\s*true/);
});

test('上游 429 时旧缓存兜底先于别名兜底', async () => {
    const source = await readFile(new URL('../cf_worker.js', import.meta.url), 'utf8');
    const start = source.indexOf('let upstreamResult = await forwardUpstream');
    const end = source.indexOf('\n    return finalizeUpstreamResponse', start);
    const upstreamFlow = source.slice(start, end);

    assert.ok(start >= 0 && end > start);
    assert.ok(upstreamFlow.indexOf('tryPersistentRateLimitFallback') >= 0);
    assert.ok(upstreamFlow.indexOf('tryUpstreamRateLimitFallback') >= 0);
    assert.ok(
        upstreamFlow.indexOf('tryPersistentRateLimitFallback')
        < upstreamFlow.indexOf('tryUpstreamRateLimitFallback')
    );
});
