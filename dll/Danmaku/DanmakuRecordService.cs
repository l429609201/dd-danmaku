namespace DD.Danmaku.Danmaku;

/// <summary>
/// 首版记录服务。由宿主适配层注入记录来源，服务只负责分页和刷新标记。
/// </summary>
public sealed class DanmakuRecordService : IDanmakuRecordService
{
    private readonly Func<CancellationToken, Task<IReadOnlyList<DanmakuRecord>>> _loader;
    private readonly Func<IReadOnlyList<DanmakuRecord>, CancellationToken, Task> _saver;
    private readonly SemaphoreSlim _gate = new(1, 1);

    /// <summary>注入记录加载和保存操作，并在本实例内串行化修改。</summary>
    public DanmakuRecordService(
        Func<CancellationToken, Task<IReadOnlyList<DanmakuRecord>>> loader,
        Func<IReadOnlyList<DanmakuRecord>, CancellationToken, Task> saver)
    {
        _loader = loader;
        _saver = saver;
    }

    /// <inheritdoc/>
    public async Task<DanmakuRecord?> GetByItemIdAsync(string itemId, CancellationToken cancellationToken)
    {
        var records = await _loader(cancellationToken);
        return records.FirstOrDefault(x => x.ItemId == itemId);
    }

    /// <inheritdoc/>
    public async Task<IReadOnlyList<DanmakuRecord>> ListAsync(int page, int pageSize, CancellationToken cancellationToken)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var records = await _loader(cancellationToken);
        return records.OrderByDescending(x => x.UpdatedAt).Skip((page - 1) * pageSize).Take(pageSize).ToArray();
    }

    /// <inheritdoc/>
    public async Task SetRefreshOnNextPlaybackAsync(string recordId, bool value, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var records = (await _loader(cancellationToken)).ToList();
            var index = records.FindIndex(x => x.RecordId == recordId);
            if (index < 0) return;
            records[index] = records[index] with { RefreshOnNextPlayback = value, UpdatedAt = DateTimeOffset.UtcNow };
            await _saver(records, cancellationToken);
        }
        finally { _gate.Release(); }
    }

    /// <inheritdoc/>
    public async Task DeleteAsync(string recordId, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            var records = (await _loader(cancellationToken)).Where(x => x.RecordId != recordId).ToArray();
            await _saver(records, cancellationToken);
        }
        finally { _gate.Release(); }
    }
}
