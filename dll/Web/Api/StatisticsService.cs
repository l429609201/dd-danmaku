namespace DD.Danmaku.Web.Api;

using DD.Danmaku.Runtime;

/// <summary>
/// 统计服务只读取运行时快照，避免 API 直接依赖 Harmony 或宿主对象。
/// </summary>
public sealed class StatisticsService : IStatisticsService
{
    private readonly Func<RuntimeSnapshot> _snapshotProvider;

    /// <summary>注入运行快照读取函数，避免直接持有宿主内部对象。</summary>
    public StatisticsService(Func<RuntimeSnapshot> snapshotProvider)
    {
        _snapshotProvider = snapshotProvider;
    }

    /// <inheritdoc/>
    public Task<IReadOnlyDictionary<string, object>> GetSummaryAsync(CancellationToken cancellationToken)
    {
        var snapshot = _snapshotProvider();
        IReadOnlyDictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal)
        {
            ["injectionAvailable"] = snapshot.InjectionAvailable,
            ["resolvedPatch"] = snapshot.ResolvedPatch ?? string.Empty,
            ["injectionHits"] = snapshot.InjectionHits,
            ["injectionSkipped"] = snapshot.InjectionSkipped,
            ["injectionFailures"] = snapshot.InjectionFailures,
            ["resourceVersion"] = snapshot.ResourceVersion,
            ["startedAt"] = snapshot.StartedAt,
            ["lastError"] = snapshot.LastError ?? string.Empty
        };
        return Task.FromResult(result);
    }
}
