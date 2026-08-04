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
    } catch (error) {
        // 本地端不可用时保持原 429 流程，但保留失败原因，避免兜底异常被静默吞掉。
        console.warn(`⚠️ 本地搜索兜底失败: ${normalized}`, error?.message || error);
        return null;
    }
}
