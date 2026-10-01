namespace DD.Danmaku.Hosting;

using System.Security.Cryptography;
using DD.Danmaku.Danmaku;

internal sealed partial class LocalPlaybackService
{
    /// <summary>共享上传与覆盖在同一锁内确定权限类别；覆盖必须提供读取版本的 SHA256。</summary>
    internal async Task SaveUploadAsync(string id, string? source, IReadOnlyList<DanmakuComment> comments,
        DanmakuXmlMetadata metadata, bool overwrite, string? expectedHash,
        Action<DanmakuWritePolicy.Operation> authorize, CancellationToken token)
    {
        await _gate.WaitAsync(token);
        try
        {
            var path = await RequirePathAsync(id, token, source);
            authorize(DanmakuWritePolicy.Operation.UploadShared);
            var operation = DanmakuWritePolicy.Operation.CreateShared;
            string? actualHash = null;
            // 客户端确认过的旧文件消失也属于冲突，不能把覆盖意图降级为新建。
            if (overwrite && (string.IsNullOrEmpty(expectedHash) || !File.Exists(path)))
                throw new ApiAccessException(409, "XML_VERSION_CONFLICT", "共享 XML 已消失或版本缺失，请重新读取后确认");
            if (File.Exists(path))
            {
                if (!overwrite) throw new ApiAccessException(409, "XML_EXISTS", "已有共享 XML，需要明确确认覆盖");
                await using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
                if (input.Length > DanmakuXml.MaxBytes) throw new IOException("共享 XML 超过限制");
                actualHash = Convert.ToHexString(await SHA256.HashDataAsync(input, token));
                if (string.IsNullOrEmpty(expectedHash) || !string.Equals(actualHash, expectedHash, StringComparison.OrdinalIgnoreCase))
                    throw new ApiAccessException(409, "XML_VERSION_CONFLICT", "共享 XML 版本已变化或缺失，请重新读取后确认");
                input.Position = 0;
                var previous = (await DanmakuXml.ReadReportAsync(input, token)).Metadata;
                operation = previous is not null && !string.IsNullOrEmpty(previous.SourceEpisodeId)
                    && previous.SourceId == NormalizeSource(source) && previous.SourceEpisodeId == metadata.SourceEpisodeId
                    ? DanmakuWritePolicy.Operation.RefreshShared : DanmakuWritePolicy.Operation.ReplaceShared;
            }
            void Authorize()
            {
                authorize(DanmakuWritePolicy.Operation.UploadShared);
                authorize(operation);
                // 防止锁外进程更改旧文件后被本插件盲目覆盖。
                if (actualHash is not null)
                {
                    using var current = File.OpenRead(path);
                    if (current.Length > DanmakuXml.MaxBytes || Convert.ToHexString(SHA256.HashData(current)) != actualHash)
                        throw new ApiAccessException(409, "XML_VERSION_CONFLICT", "共享 XML 已变化，请重新读取");
                }
            }
            Authorize();
            var updated = metadata with { EmbyItemId = id, SourceId = NormalizeSource(source) };
            await _files.SaveWithMetadataAsync(path, comments, token, actualHash is not null, updated, Authorize);
            // 正文成功后再写索引，失败明确报告部分提交。
            try
            {
                await records.MutateAsync(items =>
                {
                    var normalized = NormalizeSource(source);
                    var index = items.FindIndex(x => x.ItemId == id && JsonDanmakuRecordStore.GetEffectiveSource(x) == normalized);
                    var now = DateTimeOffset.UtcNow;
                    var row = new DanmakuRecord(normalized is null ? id : id + "|" + normalized, id,
                        updated.SourceAnimeId, updated.SourceEpisodeId, normalized, comments.Count, null,
                        index < 0 ? now : items[index].StoredAt, now, null, null, false, null, "none", "sidecar", 1)
                    { UpdatedByUserId = updated.UpdatedByUserId, WriteMethod = "upload", FetchedAt = updated.FetchedAt };
                    if (index < 0) items.Add(row); else items[index] = row;
                }, token);
            }
            catch (Exception) { throw PartialCommit(); }
        }
        finally { _gate.Release(); }
    }
}
