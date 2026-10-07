namespace DD.Danmaku.Danmaku;

internal sealed partial class DanmakuSelectionService
{
    // 与正文事务锁分离：等待上游时不阻塞读取、撤销和清理。
    private readonly SemaphoreSlim _refreshGate = new(1, 1);

    internal async Task<IReadOnlyList<DanmakuComment>> RefreshAsync(UserDanmakuSelection expected,
        Action authorize, Func<Task<IReadOnlyList<DanmakuComment>>> fetch, CancellationToken token)
    {
        await _refreshGate.WaitAsync(token);
        try
        {
            authorize();
            var current = await FindAsync(expected.UserId, expected.Content.ItemId, token);
            if (current is null || current.SelectionId != expected.SelectionId || current.Content != expected.Content)
                throw new InvalidOperationException("用户选择已撤销或变化");
            // 自动播放仅复用正文，不更新持久访问时间或恢复缓存文件。
            var fresh = await ReadFreshAsync(current, token, touchAccess: false);
            if (fresh is not null) return fresh;
            if (current.Revision != expected.Revision)
                throw new InvalidOperationException("用户选择版本已变化");
            var comments = await fetch();
            authorize();
            var latest = await FindAsync(expected.UserId, expected.Content.ItemId, token);
            if (latest != current) throw new InvalidOperationException("用户选择已撤销或变化");
            // 过期缓存恢复只供当前播放使用；重新落盘必须重新手动搜索并确认分集。
            return comments;
        }
        finally { _refreshGate.Release(); }
    }
}
