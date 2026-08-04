import test from 'node:test';
import assert from 'node:assert/strict';
import { tryLocalSearchFallback } from './local_search_fallback.mjs';

test('命中时返回完整 dandanplay 搜索契约', async () => {
    const anime = { animeId: 16296, animeTitle: 'OVERLORD IV', episodes: [] };
    const calls = [];
    const result = await tryLocalSearchFallback({
        keyword: 'overlord iv',
        rpc: async (...args) => {
            calls.push(args);
            return { success: true, data: [anime] };
        },
        extraHeaders: { 'X-Upstream-Status': '429' },
    });

    assert.deepEqual(calls, [['alias.query', { keyword: 'overlord iv' }, 5000]]);
    assert.equal(result.response.status, 200);
    assert.equal(result.response.headers.get('X-Cache'), 'LOCAL-ALIAS-FALLBACK');
    assert.equal(result.response.headers.get('X-Upstream-Status'), '429');
    assert.deepEqual(JSON.parse(result.body), {
        hasMore: false,
        animes: [anime],
        errorCode: 0,
        success: true,
    });
});

test('空结果、失败响应和空关键词均不接管原 429', async () => {
    const empty = await tryLocalSearchFallback({
        keyword: 'overlord iv',
        rpc: async () => ({ success: true, data: [] }),
    });
    const failed = await tryLocalSearchFallback({
        keyword: 'overlord iv',
        rpc: async () => ({ success: false, data: [{ animeId: 1 }] }),
    });
    const blank = await tryLocalSearchFallback({ keyword: '  ', rpc: async () => ({}) });

    assert.equal(empty, null);
    assert.equal(failed, null);
    assert.equal(blank, null);
});

test('RPC 异常时静默回退到原 429 流程', async () => {
    const result = await tryLocalSearchFallback({
        keyword: 'overlord iv',
        rpc: async () => { throw new Error('timeout'); },
    });
    assert.equal(result, null);
});
