namespace DD.Danmaku.Danmaku;

internal sealed partial class DanmakuSelectionService
{
    /// <summary>验证恢复日志的原始意图；没有持久撤销历史时，缺失内存意图必须安全拒绝。</summary>
    internal async Task<bool> TryAdoptIntentAsync(string userId, string itemId, string intent,
        DateTimeOffset createdAt, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        static bool ValidId(string? value) => Guid.TryParseExact(value, "N", out var id) && id != Guid.Empty;
        if (!ValidId(userId) || !ValidId(itemId) || !ValidId(intent)) return false;
        await _gate.WaitAsync(token).ConfigureAwait(false);
        try
        {
            var now = DateTimeOffset.UtcNow;
            PruneIntents(now);
            if (createdAt == default || createdAt > now || now - createdAt >= IntentTtl) return false;
            if (!_intents.TryGetValue((userId, itemId), out var current) || current.Id != intent) return false;
            // 日志时间不能延长内存意图寿命；两者取较早值，保留原始内存时间不重新预订。
            var originalAt = createdAt < current.CreatedAt ? createdAt : current.CreatedAt;
            var snapshot = await _store.ReadAsync(token).ConfigureAwait(false);
            if (snapshot.Selections.Any(selection => selection.UserId == userId
                && selection.Content.ItemId == itemId && selection.SelectedAt >= originalAt)) return false;
            // 索引没有撤销墓碑，跨重启无法证明最新用户动作；上面只接受现存同一意图。
            return true;
        }
        finally { _gate.Release(); }
    }
}
