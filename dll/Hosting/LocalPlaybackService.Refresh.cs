namespace DD.Danmaku.Hosting;

using DD.Danmaku.Danmaku;

internal sealed partial class LocalPlaybackService
{
    /// <summary>共享刷新在同一文件锁内读取绑定、取回、覆盖，避免并发重复刷新或覆盖新上传。</summary>
    internal async Task<string?> RefreshSharedAsync(string id, string? source, int freshHours,
        Action authorize, Func<DanmakuXmlMetadata, Task<IReadOnlyList<DanmakuComment>>> fetch,
        string actor, CancellationToken token)
    {
        await _gate.WaitAsync(token);
        try
        {
            var path = await RequirePathAsync(id, token, source);
            DanmakuXml.ReadReport report;
            try
            {
                await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
                report = await DanmakuXml.ReadReportAsync(stream, token);
            }
            catch (FileNotFoundException) { return null; }
            catch (DirectoryNotFoundException) { return null; }
            var metadata = report.Metadata;
            if (metadata is null || string.IsNullOrEmpty(metadata.SourceId)
                || string.IsNullOrEmpty(metadata.SourceEpisodeId) || string.IsNullOrEmpty(metadata.UpstreamRevision)
                || metadata.ChConvert is null or < 0 or > 2) return "SHARED_BINDING_UNKNOWN";
            if (metadata.EmbyItemId != id || metadata.SourceId != NormalizeSource(source))
                return "SHARED_BINDING_MISMATCH";
            var now = DateTimeOffset.UtcNow;
            if (metadata.FetchedAt is { } fetched && fetched <= now
                && now - fetched < TimeSpan.FromHours(freshHours)) return null;
            // 保存原始版本；上游请求期间外部工具可能替换旁车。
            byte[] hash;
            try
            {
                // 先限制长度再流式计算散列，不能一次性分配外部文件声明的全部内存。
                await using var snapshot = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
                if (snapshot.Length > DanmakuXml.MaxBytes) throw new IOException("共享 XML 超过限制");
                hash = await System.Security.Cryptography.SHA256.HashDataAsync(snapshot, token);
                snapshot.Position = 0;
                var current = await DanmakuXml.ReadReportAsync(snapshot, token);
                if (current.Metadata != metadata) return "XML_VERSION_CONFLICT";
            }
            catch (FileNotFoundException) { return "XML_VERSION_CONFLICT"; }
            void AuthorizeVersion()
            {
                authorize();
                using var current = File.OpenRead(path);
                if (current.Length > DanmakuXml.MaxBytes
                    || !System.Security.Cryptography.SHA256.HashData(current).SequenceEqual(hash))
                    throw new ApiAccessException(409, "XML_VERSION_CONFLICT", "共享 XML 已变化，放弃刷新覆盖");
            }
            AuthorizeVersion();
            var comments = await fetch(metadata);
            AuthorizeVersion();
            // 获取时间只在成功取得新正文时更新，失败不删除旧文件。
            var updated = metadata with { FetchedAt = DateTimeOffset.UtcNow,
                UpdatedByUserId = actor, WriteMethod = "refresh" };
            await _files.SaveWithMetadataAsync(path, comments, token, true, updated, AuthorizeVersion);
            await records.MutateAsync(items =>
            {
                var index = items.FindIndex(x => x.ItemId == id
                    && JsonDanmakuRecordStore.GetEffectiveSource(x) == NormalizeSource(source));
                if (index >= 0) items[index] = items[index] with { CommentCount = comments.Count,
                    FetchedAt = updated.FetchedAt, UpdatedAt = DateTimeOffset.UtcNow,
                    UpdatedByUserId = actor, WriteMethod = "refresh", RefreshState = "fresh" };
            }, token);
            return null;
        }
        finally { _gate.Release(); }
    }
}
