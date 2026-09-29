namespace DD.Danmaku.Runtime;

/// <summary>
/// 运行期只读状态，避免 API 直接暴露可变内部对象。
/// </summary>
/// <param name="InjectionAvailable">引导注入当前是否可用。</param>
/// <param name="ResolvedPatch">已解析的补丁目标，尚未解析时为空。</param>
/// <param name="InjectionHits">成功注入次数。</param>
/// <param name="InjectionSkipped">跳过注入次数。</param>
/// <param name="InjectionFailures">注入失败次数。</param>
/// <param name="ResourceVersion">前端资源版本标识。</param>
/// <param name="StartedAt">插件服务启动时间。</param>
/// <param name="LastError">最近错误信息，无错误时为空。</param>
public sealed record RuntimeSnapshot(
    bool InjectionAvailable,
    string? ResolvedPatch,
    long InjectionHits,
    long InjectionSkipped,
    long InjectionFailures,
    string ResourceVersion,
    DateTimeOffset StartedAt,
    string? LastError);

/// <summary>通过原子计数记录并发请求中的注入结果。</summary>
public sealed class RuntimeStatistics
{
    private long _injectionHits;
    private long _injectionSkipped;
    private long _injectionFailures;

    /// <summary>累计成功注入次数。</summary>
    public long InjectionHits => Interlocked.Read(ref _injectionHits);
    /// <summary>累计跳过注入次数。</summary>
    public long InjectionSkipped => Interlocked.Read(ref _injectionSkipped);
    /// <summary>累计注入失败次数。</summary>
    public long InjectionFailures => Interlocked.Read(ref _injectionFailures);

    /// <summary>原子增加一次成功注入计数。</summary>
    public void AddHit() => Interlocked.Increment(ref _injectionHits);
    /// <summary>原子增加一次跳过注入计数。</summary>
    public void AddSkipped() => Interlocked.Increment(ref _injectionSkipped);
    /// <summary>原子增加一次注入失败计数。</summary>
    public void AddFailure() => Interlocked.Increment(ref _injectionFailures);
}
