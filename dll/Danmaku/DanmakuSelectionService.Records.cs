namespace DD.Danmaku.Danmaku;

internal sealed partial class DanmakuSelectionService
{
    /// <summary>管理查询只复制元数据，不读正文，返回值不能修改存储集合。</summary>
    internal async Task<IReadOnlyList<UserDanmakuSelection>> ListAsync(CancellationToken token)
    {
        await _gate.WaitAsync(token);
        try { return (await _store.ReadAsync(token)).Selections.ToArray(); }
        finally { _gate.Release(); }
    }
}
