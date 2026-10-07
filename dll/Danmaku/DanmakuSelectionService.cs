namespace DD.Danmaku.Danmaku;

/// <summary>选择及缓存清理协调；所有正文操作必须经过本实例的锁。</summary>
internal sealed partial class DanmakuSelectionService
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Dictionary<(string User, string Item), (string Id, DateTimeOffset CreatedAt)> _intents = new();
    private static readonly TimeSpan IntentTtl = TimeSpan.FromMinutes(20);
    private const int MaxIntents = 1024;
    private readonly DanmakuSelectionStore _store;
    private readonly SelectionBodyStore _bodies;
    private readonly Func<PluginConfiguration> _configuration;

    internal DanmakuSelectionService(string directory, Func<PluginConfiguration> configuration)
    {
        _store = new(directory);
        _bodies = new(Path.Combine(directory, "bodies"));
        _configuration = configuration;
    }

    /// <summary>在正文事务锁内接受最新选择意图；相同用户和媒体的旧下载不能再提交选择。</summary>
    internal async Task<string> ReserveIntentAsync(string userId, string itemId, CancellationToken token)
    {
        if (string.IsNullOrWhiteSpace(userId) || string.IsNullOrWhiteSpace(itemId))
            throw new ArgumentException("用户或媒体标识无效");
        await _gate.WaitAsync(token);
        try
        {
            var now = DateTimeOffset.UtcNow;
            PruneIntents(now);
            var key = (userId, itemId);
            if (!_intents.ContainsKey(key) && _intents.Count >= MaxIntents)
                _intents.Remove(_intents.MinBy(entry => entry.Value.CreatedAt).Key);
            var id = Guid.NewGuid().ToString("N");
            _intents[key] = (id, now);
            return id;
        }
        finally { _gate.Release(); }
    }

    // 淘汰后只能拒绝该意图，不能把缺失记录解释成允许旧下载重新提交。
    private void PruneIntents(DateTimeOffset now)
    {
        foreach (var key in _intents.Where(entry => now - entry.Value.CreatedAt >= IntentTtl)
            .Select(entry => entry.Key).ToArray()) _intents.Remove(key);
    }

    private void RequireIntent(string userId, string itemId, string? intent)
    {
        if (intent is null) return;
        if (!Guid.TryParseExact(intent, "N", out _) || !_intents.TryGetValue((userId, itemId), out var current)
            || current.Id != intent || DateTimeOffset.UtcNow - current.CreatedAt >= IntentTtl)
            throw new InvalidOperationException("用户选择已变化，请重新查询");
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
                _intents.Remove((userId, itemId));
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
