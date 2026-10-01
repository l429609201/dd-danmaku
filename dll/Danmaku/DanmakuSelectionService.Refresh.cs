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
            // 前一个播放请求已刷新时复用新正文，不重复请求上游。
            var fresh = await ReadFreshAsync(current, token);
            if (fresh is not null) return fresh;
            if (current.Revision != expected.Revision)
                throw new InvalidOperationException("用户选择版本已变化");
            var comments = await fetch();
            await SaveAsync(current.UserId, current.Content, comments, authorize, token, current.Revision);
            return comments;
        }
        finally { _refreshGate.Release(); }
    }
}
