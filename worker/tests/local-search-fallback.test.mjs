import test from 'node:test';
import assert from 'node:assert/strict';
import { tryLocalSearchFallback } from '../local_search_fallback.mjs';

test('别名兜底返回统一 dandanplay 搜索结构', async () => {
    const calls = [];
    const result = await tryLocalSearchFallback({
        keyword: ' OVERLORD ',
        rpc: async (...args) => {
            calls.push(args);
            return { success: true, data: [{ animeId: 1 }, { animeId: 2 }] };
        },
        extraHeaders: { 'X-Key-Pool': 'EXHAUSTED' },
    });

    assert.deepEqual(calls[0], ['alias.query', { keyword: 'OVERLORD' }, 5000]);
    assert.deepEqual(JSON.parse(result.body), {
        hasMore: false,
        animes: [{ animeId: 1 }, { animeId: 2 }],
        errorCode: 0,
        success: true,
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.response.headers.get('X-Cache'), 'LOCAL-ALIAS-FALLBACK');
    assert.equal(result.response.headers.get('X-Key-Pool'), 'EXHAUSTED');
});

test('空结果、失败结果和 RPC 异常都保持原 429 流程', async () => {
    assert.equal(await tryLocalSearchFallback({
        keyword: '', rpc: async () => ({ success: true, data: [1] }),
    }), null);
    assert.equal(await tryLocalSearchFallback({
        keyword: 'x', rpc: async () => ({ success: false, data: [1] }),
    }), null);
    assert.equal(await tryLocalSearchFallback({
        keyword: 'x', rpc: async () => { throw new Error('offline'); },
    }), null);
});
