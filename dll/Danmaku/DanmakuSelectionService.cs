namespace DD.Danmaku.Danmaku;

/// <summary>选择及缓存清理协调；所有正文操作必须经过本实例的锁。</summary>
internal sealed partial class DanmakuSelectionService
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly DanmakuSelectionStore _store;
    private readonly SelectionBodyStore _bodies;
    private readonly Func<PluginConfiguration> _configuration;

    internal DanmakuSelectionService(string directory, Func<PluginConfiguration> configuration)
    {
        _store = new(directory);
        _bodies = new(Path.Combine(directory, "bodies"));
        _configuration = configuration;
    }

    internal async Task<UserDanmakuSelection?> FindAsync(string userId, string itemId, CancellationToken token)
    {
        await _gate.WaitAsync(token);
        try
        {
            var snapshot = await _store.ReadAsync(token);
            var now = DateTimeOffset.UtcNow;
            return snapshot.Selections.SingleOrDefault(x => x.UserId == userId
                && x.Content.ItemId == itemId && x.IsActive(now));
        }
        finally { _gate.Release(); }
    }

    internal async Task RestoreSharedAsync(string userId, string itemId, Action authorize, CancellationToken token)
    {
        await _gate.WaitAsync(token);
        try
        {
            await _store.MutateAsync(snapshot =>
            {
                // 在锁内重新鉴权；只移除本人选择，不删除其他引用或共享文件。
                authorize();
                snapshot.Selections.RemoveAll(x => x.UserId == userId && x.Content.ItemId == itemId);
            }, token);
        }
        finally { _gate.Release(); }
    }

    internal async Task SetRetentionAsync(string selectionId, long revision, bool keepForever,
        string actor, Action authorizeAdministrator, CancellationToken token)
    {
        await _gate.WaitAsync(token);
        try
        {
            await _store.MutateAsync(snapshot =>
            {
                authorizeAdministrator();
                var index = snapshot.Selections.FindIndex(x => x.SelectionId == selectionId);
                if (index < 0) throw new KeyNotFoundException("用户选择不存在");
                var previous = snapshot.Selections[index];
                if (previous.Revision != revision) throw new InvalidOperationException("用户选择已变化，请刷新后重试");
                var config = _configuration();
                var now = DateTimeOffset.UtcNow;
                snapshot.Selections[index] = previous.WithRetention(keepForever, config.DanmakuSelectionDays, actor, now);
                // 恢复默认保留不修改正文 FetchedAt，也不取消其他人的长期引用。
                var bodyIndex = snapshot.Contents.FindIndex(x => x.Identity == previous.Content);
                if (!keepForever && bodyIndex >= 0)
                {
                    var content = snapshot.Contents[bodyIndex];
                    var until = now.AddHours(config.TemporaryDanmakuHours);
                    snapshot.Contents[bodyIndex] = content with
                    { RetainUntil = content.RetainUntil > until ? content.RetainUntil : until };
                }
            }, token);
        }
        finally { _gate.Release(); }
    }

    internal async Task CleanupAsync(CancellationToken token)
    {
        await _gate.WaitAsync(token);
        try
        {
            var now = DateTimeOffset.UtcNow;
            var snapshot = await _store.ReadAsync(token);
            var pinned = snapshot.Selections.Where(x => x.KeepForever).Select(x => x.Content).ToHashSet();
            var removed = new HashSet<string>(StringComparer.Ordinal);
            foreach (var content in snapshot.Contents)
            {
                token.ThrowIfCancellationRequested();
                if (content.RetainUntil > now || pinned.Contains(content.Identity)) continue;
                // 不抓取、不读取共享旁车；删除失败保留索引供下次清理重试。
                _bodies.Delete(content.CacheKey);
                removed.Add(content.CacheKey);
            }
            await _store.MutateAsync(current =>
            {
                current.Selections.RemoveAll(x => !x.IsActive(now));
                current.Contents.RemoveAll(x => removed.Contains(x.CacheKey));
            }, token);
            // 索引成功读取并提交后才允许回收孤立文件，损坏索引不得触发全量删除。
            var committed = await _store.ReadAsync(token);
            _bodies.ReclaimOrphans(committed.Contents.Select(x => x.CacheKey)
                .ToHashSet(StringComparer.OrdinalIgnoreCase), token);
        }
        finally { _gate.Release(); }
    }
}
