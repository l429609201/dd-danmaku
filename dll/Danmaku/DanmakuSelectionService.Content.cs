namespace DD.Danmaku.Danmaku;

using System.Security.Cryptography;

internal sealed partial class DanmakuSelectionService
{
    /// <summary>明确选择可续期；播放刷新必须携带旧版本，不能复活已撤销或过期的选择。</summary>
    internal async Task<UserDanmakuSelection> SaveAsync(string userId, SelectionContentIdentity identity,
        IReadOnlyList<DanmakuComment> comments, Action authorize, CancellationToken token,
        long? expectedRevision = null)
    {
        await _gate.WaitAsync(token);
        try
        {
            authorize();
            var config = _configuration();
            var now = DateTimeOffset.UtcNow;
            var snapshot = await _store.ReadAsync(token);
            var previous = snapshot.Selections.SingleOrDefault(x => x.UserId == userId
                && x.Content.ItemId == identity.ItemId);
            if (expectedRevision is { } revision && (previous is null || previous.Revision != revision
                || previous.Content != identity || !previous.IsActive(now)))
                throw new InvalidOperationException("用户选择已变化，请重新查询");
            var keepForever = previous?.KeepForever == true;
            var selection = new UserDanmakuSelection(previous?.SelectionId ?? Guid.NewGuid().ToString("N"),
                userId, identity, expectedRevision.HasValue ? previous!.SelectedAt : now,
                keepForever ? null : expectedRevision.HasValue ? previous!.ExpiresAt : now.AddDays(config.DanmakuSelectionDays),
                keepForever, checked((previous?.Revision ?? 0) + 1), userId);
            if (previous is null && snapshot.Selections.Count(x => x.UserId == userId && x.IsActive(now))
                >= config.DanmakuSelectionLimitPerUser)
                throw new InvalidOperationException("当前用户的弹幕选择数量已达上限");
            var bytes = await SelectionBodyStore.SerializeAsync(identity, comments, now, token);
            // 为每次提交分配独立散列版本；直到索引切换前，旧正文保持可读。
            var key = Convert.ToHexString(SHA256.HashData(Guid.NewGuid().ToByteArray()));
            var oldBody = snapshot.Contents.SingleOrDefault(x => x.Identity == identity);
            var pinned = snapshot.Selections.Where(x => x.KeepForever).Select(x => x.Content).ToHashSet();
            var limit = checked((long)config.TemporaryDanmakuLimitMiB * 1024 * 1024);
            // 按实际磁盘占用核算，索引提交失败遗留文件也计入容量，不能绕过上限。
            var inventory = _bodies.Inventory(token);
            var sizes = inventory.Where(x => x.Key is not null)
                .GroupBy(x => x.Key!, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(x => x.Key, x => x.Sum(f => f.Bytes), StringComparer.OrdinalIgnoreCase);
            var size = checked(inventory.Sum(x => x.Bytes) + bytes.LongLength);
            var victims = new List<SelectionContentEntry>();
            foreach (var candidate in snapshot.Contents.Where(x => x.Identity != identity && !pinned.Contains(x.Identity))
                .OrderBy(x => x.RetainUntil > now).ThenBy(x => x.LastAccessAt))
            {
                if (size <= limit) break;
                victims.Add(candidate);
                size -= sizes.GetValueOrDefault(candidate.CacheKey);
            }
            if (size > limit) throw new IOException("临时缓存容量不足，长期保留正文不能自动淘汰");
            // 先完整计算可腾出空间，再删除；容量不足不会提前清空其他缓存。
            foreach (var victim in victims) { authorize(); _bodies.Delete(victim.CacheKey); }
            await _store.MutateAsync(current =>
            {
                authorize();
                current.Selections.RemoveAll(x => !x.IsActive(now));
                current.Contents.RemoveAll(x => victims.Any(v => v.CacheKey == x.CacheKey));
            }, token);
            await _bodies.WriteAsync(key, bytes, authorize, token);
            try
            {
                await _store.MutateAsync(current =>
                {
                    authorize();
                    current.Selections.RemoveAll(x => x.UserId == userId && x.Content.ItemId == identity.ItemId);
                    current.Selections.Add(selection);
                    current.Contents.RemoveAll(x => x.Identity == identity);
                    current.Contents.Add(new(key, identity, now, now.AddHours(config.TemporaryDanmakuHours),
                        now, bytes.LongLength, comments.Count));
                }, token);
            }
            catch
            {
                // 未被索引引用的新版本可安全回收；清理异常不能遮蔽提交异常。
                TryDeleteBody(key);
                throw;
            }
            if (oldBody is not null) TryDeleteBody(oldBody.CacheKey);
            return selection;
        }
        finally { _gate.Release(); }
    }

    /// <summary>只返回仍属于当前用户选择且新鲜的正文，缺失或过期交给播放层刷新。</summary>
    internal async Task<IReadOnlyList<DanmakuComment>?> ReadFreshAsync(UserDanmakuSelection selection,
        CancellationToken token)
    {
        await _gate.WaitAsync(token);
        try
        {
            var snapshot = await _store.ReadAsync(token);
            var now = DateTimeOffset.UtcNow;
            if (!selection.IsActive(now) || !snapshot.Selections.Contains(selection)) return null;
            var body = snapshot.Contents.SingleOrDefault(x => x.Identity == selection.Content);
            if (body is null || !body.IsFresh(now, _configuration().TemporaryDanmakuHours)) return null;
            var comments = await _bodies.ReadAsync(body.CacheKey, token);
            if (comments is null) return null;
            await _store.MutateAsync(current =>
            {
                var index = current.Contents.FindIndex(x => x.CacheKey == body.CacheKey);
                if (index >= 0) current.Contents[index] = body with { LastAccessAt = now };
            }, token);
            return comments;
        }
        finally { _gate.Release(); }
    }

    private void TryDeleteBody(string key)
    {
        try { _bodies.Delete(key); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
