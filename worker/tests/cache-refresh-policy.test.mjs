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

test('上游转发函数不读取 handleRequest 局部 ACCESS_CONFIG', () => {
    const start = source.indexOf('async function forwardWithKey');
    const end = source.indexOf('\nasync function forwardUpstream', start);
    const forwardSource = source.slice(start, end);

    assert.ok(start >= 0 && end > start);
    assert.match(forwardSource, /getAccessConfig\(\)\.logging\.enabled/);
    assert.doesNotMatch(forwardSource, /if\s*\(ACCESS_CONFIG\./);
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

test('本地组装响应透传来源并细分日志缓存类型', () => {
    const start = source.indexOf('async function tryLocalApiCache');
    const end = source.indexOf('\nasync function tryEdgeCaches', start);
    const localCacheSource = source.slice(start, end);

    assert.ok(start >= 0 && end > start);
    assert.match(localCacheSource, /X-Cache-Source/);
    assert.match(localCacheSource, /LOCAL-ASSEMBLED-SERIES/);
    assert.match(localCacheSource, /LOCAL-ASSEMBLED-EPISODES/);
    assert.match(localCacheSource, /本地端组装缓存命中/);
});


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



test('X-HUIYUAN 仅在值为1时强制跳过边缘缓存', () => {
    const contextMatch = source.match(/function createRequestContext\(request\) \{[\s\S]*?\n\}/);
    assert.ok(contextMatch, '主脚本必须包含请求上下文函数');
    const createRequestContext = Function(`${contextMatch[0]};return createRequestContext;`)();

    assert.equal(createRequestContext(new Request('https://worker.test/')).forceOrigin, false);
    assert.equal(createRequestContext(new Request('https://worker.test/', {
        headers: { 'X-HUIYUAN': '0' },
    })).forceOrigin, false);
    assert.equal(createRequestContext(new Request('https://worker.test/', {
        headers: { 'X-HUIYUAN': '1' },
    })).forceOrigin, true);

    const edgeStart = source.indexOf('async function tryEdgeCaches');
    const edgeEnd = source.indexOf('\nasync function tryOriginQuotaFallback', edgeStart);
    const edgeSource = source.slice(edgeStart, edgeEnd);
    assert.match(edgeSource, /requestContext\.forceOrigin/);
    assert.match(edgeSource, /强制回源/);
    assert.match(source, /Access-Control-Allow-Headers[^\n]*X-HUIYUAN/);
    assert.match(source, /lowerKey !== 'x-huiyuan'/);
});


test('裸系列词不会被唯一高季度上游结果冒充', () => {
    const helperMatch = source.match(/function suppressMisleadingBareSeries\(apiPath, targetUrl, responseText\) \{[\s\S]*?\n\}/);
    assert.ok(helperMatch, '主脚本必须包含裸系列高季度保护函数');
    const helper = Function(
        `${source.match(/function normalizeSearchKeyword\(kw\) \{[\s\S]*?\n\}/)[0]};${helperMatch[0]};return suppressMisleadingBareSeries;`
    )();
    const bareUrl = new URL('https://api.test/api/v2/search/episodes?anime=欢迎来到实力至上主义的教室');
    const seasonUrl = new URL('https://api.test/api/v2/search/episodes?anime=欢迎来到实力至上主义的教室 第五季');
    const upstream = JSON.stringify({
        hasMore: false,
        animes: [{ animeId: 20123, animeTitle: '欢迎来到实力至上主义的教室 第五季', episodes: [] }],
        errorCode: 0, success: true,
    });

    assert.deepEqual(
        JSON.parse(helper('/api/v2/search/episodes', bareUrl, upstream)).animes,
        []
    );
    assert.equal(helper('/api/v2/search/episodes', seasonUrl, upstream), upstream);
});
