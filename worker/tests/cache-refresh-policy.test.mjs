import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../cf_worker.js', import.meta.url), 'utf8');
const policyMatch = source.match(/function classifyLocalCache\(local\) \{[\s\S]*?\n\}/);
assert.ok(policyMatch, '主脚本必须包含本地缓存判定函数');
const classifyLocalCache = Function(`${policyMatch[0]}; return classifyLocalCache;`)();

test('新鲜本地缓存直接返回，stale 缓存继续回源刷新', () => {
    assert.equal(classifyLocalCache({ hit: true, body: '{}', stale: false }), 'serve');
    assert.equal(classifyLocalCache({ hit: true, body: '{}', stale: true }), 'refresh');
    assert.equal(classifyLocalCache({ hit: false, body: '{}' }), 'miss');
    assert.equal(classifyLocalCache(null), 'miss');
});


test('缓存判定不依赖新增运行时模块，兼容主脚本单文件热更新', () => {
    assert.doesNotMatch(source, /cache_refresh_policy\.mjs/);
    assert.match(source, /function classifyLocalCache\(local\)/);
});

test('顶层异常详情写入可持久化字段', () => {
    const start = source.indexOf("addMemoryLog('ERROR', 'Worker 顶层异常'");
    const end = source.indexOf('\n      } catch (_)', start);
    const errorLogSource = source.slice(start, end);

    assert.ok(start >= 0 && end > start);
    assert.match(errorLogSource, /responseBody:\s*truncateBody\(errorDetail\)/);
    assert.doesNotMatch(errorLogSource, /\bmessage:/);
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
