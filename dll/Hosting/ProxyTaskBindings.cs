namespace DD.Danmaku.Hosting;

/// <summary>短期异步任务归属表；不持久化令牌，不允许凭任务 ID 跨用户轮询。</summary>
internal static class ProxyTaskBindings
{
    private sealed record Binding(string UserId, string ItemId, string EpisodeId,
        string Upstream, DateTimeOffset ExpiresAt);
    private static readonly object Gate = new();
    private static readonly Dictionary<string, Binding> Items = new(StringComparer.Ordinal);

    internal static void Register(string taskId, string userId, string itemId, string episodeId, string upstream)
    {
        lock (Gate)
        {
            var now = DateTimeOffset.UtcNow;
            foreach (var key in Items.Where(pair => pair.Value.ExpiresAt <= now).Select(pair => pair.Key).ToArray())
                Items.Remove(key);
            var keyId = userId + "|" + taskId;
            if (!Items.ContainsKey(keyId) && Items.Count >= 2048)
                throw new ApiAccessException(429, "PROXY_TASK_LIMIT", "代理异步任务过多，请稍后重试");
            // 同用户的同一任务也不允许被另一媒体上下文覆盖。
            if (Items.TryGetValue(keyId, out var previous)
                && (previous.ItemId != itemId || previous.EpisodeId != episodeId || previous.Upstream != upstream))
                throw new ApiAccessException(409, "PROXY_TASK_CONFLICT", "异步任务媒体上下文不一致");
            Items[keyId] = new(userId, itemId, episodeId, upstream, now.AddMinutes(12));
        }
    }

    internal static void Require(string taskId, string userId, string itemId, string upstream)
    {
        lock (Gate)
        {
            var key = userId + "|" + taskId;
            if (!Items.TryGetValue(key, out var binding) || binding.ExpiresAt <= DateTimeOffset.UtcNow
                || binding.UserId != userId || binding.ItemId != itemId || binding.Upstream != upstream)
                throw new ApiAccessException(404, "PROXY_TASK_UNAVAILABLE", "异步任务不存在、已过期或不属于当前媒体");
        }
    }
}
