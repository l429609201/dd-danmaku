namespace DD.Danmaku.Hosting;

using DD.Danmaku.Danmaku;
using MediaBrowser.Model.Logging;

/// <summary>仅清理插件临时缓存；不抓取上游，不访问媒体旁车。</summary>
internal sealed class SelectionCleanupWorker : IDisposable
{
    private readonly CancellationTokenSource _stop = new();
    private readonly Task _loop;
    private int _disposed;

    internal SelectionCleanupWorker(DanmakuSelectionService selections, ILogger logger)
    {
        // 单循环等待上一轮完成，避免慢磁盘导致定时任务重叠。
        _loop = Task.Run(async () =>
        {
            var token = _stop.Token;
            try
            {
                while (!token.IsCancellationRequested)
                {
                    try { await selections.CleanupAsync(token); }
                    catch (OperationCanceledException) when (token.IsCancellationRequested) { break; }
                    catch (Exception error)
                    {
                        // 不记录缓存路径或用户身份；索引异常时保持失败关闭。
                        logger.Warn("弹幕临时缓存清理失败，将在下轮重试：{0}", error.GetType().Name);
                    }
                    await Task.Delay(TimeSpan.FromMinutes(30), token);
                }
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { }
        });
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        _stop.Cancel();
        // 不阻塞宿主卸载线程；待循环退出后再释放取消源。
        _ = _loop.ContinueWith(_ => _stop.Dispose(), CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
    }
}
