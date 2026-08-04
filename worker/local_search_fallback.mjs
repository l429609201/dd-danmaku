// 统一构造本地别名兜底响应，确保所有 429 路径遵循同一搜索契约。
export async function tryLocalSearchFallback({ keyword, rpc, extraHeaders = {} }) {
    const normalized = String(keyword || '').trim();
    if (!normalized || typeof rpc !== 'function') return null;

    try {
        const rpcResult = await rpc('alias.query', { keyword: normalized }, 5000);
        const animes = rpcResult?.success === true && Array.isArray(rpcResult.data)
            ? rpcResult.data
            : [];
        if (animes.length === 0) return null;

        const body = JSON.stringify({
            hasMore: false,
            animes,
            errorCode: 0,
            success: true,
        });
        return {
            body,
            count: animes.length,
            response: new Response(body, {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'X-Cache': 'LOCAL-ALIAS-FALLBACK',
                    ...extraHeaders,
                },
            }),
        };
    } catch {
        // 本地端不可用时保持原 429 流程，兜底本身不能阻断请求。
        return null;
    }
}
