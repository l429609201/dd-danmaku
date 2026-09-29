namespace DD.Danmaku.Hosting;

using DD.Danmaku.Danmaku;

internal sealed partial class LocalPlaybackService
{
    internal Task<IReadOnlyList<DanmakuRecord>> RecordSnapshotAsync(CancellationToken token) => records.LoadAsync(token);

    // 所有操作在同一锁内重新读取记录，避免校验后覆盖并发保存的索引。
    internal async Task<object> ManageRecordAsync(string recordId, string action,
        Func<string, string> authorize, CancellationToken token)
    {
        if (string.IsNullOrWhiteSpace(recordId) || recordId.Length > 160) throw new ArgumentException("记录标识无效");
        await _gate.WaitAsync(token);
        try
        {
            var record = (await records.LoadAsync(token)).FirstOrDefault(r => r.RecordId == recordId)
                ?? throw new ApiAccessException(404, "RECORD_NOT_FOUND", "记录已不存在，请刷新列表");
            // 仅移除索引允许处理失联媒体，不涉及任何文件操作。
            if (action == "remove")
            {
                await records.MutateAsync(items => items.RemoveAll(r => r.RecordId == recordId), token);
                return new { Removed = true };
            }
            var id = authorize(record.ItemId);
            var source = JsonDanmakuRecordStore.GetEffectiveSource(record);
            var path = await RequirePathAsync(id, token, source);
            if (action == "delete")
            {
                await _files.DeleteAsync(path, token);
                try { await records.MutateAsync(items => items.RemoveAll(r => r.RecordId == recordId), token); }
                catch (Exception) { throw PartialCommit(); }
                return new { Removed = true };
            }
            // 下载保留原文件内容；限制大小并拒绝链接，与播放器读取边界一致。
            IReadOnlyList<DanmakuComment> comments = [];
            var state = "valid";
            try
            {
                await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
                var info = new FileInfo(path);
                if (info.LinkTarget is not null || (info.Attributes & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("不允许读取链接旁车文件");
                if (stream.Length > DanmakuXml.MaxBytes) throw new IOException("弹幕文件超过限制");
                if (action == "download")
                {
                    using var buffer = new MemoryStream();
                    var block = new byte[81920];
                    int read;
                    // 外部进程可能在读取期间增大文件，按实际读取字节再次限制。
                    while ((read = await stream.ReadAsync(block.AsMemory(), token)) > 0)
                    {
                        if (buffer.Length + read > DanmakuXml.MaxBytes) throw new IOException("弹幕文件超过限制");
                        buffer.Write(block, 0, read);
                    }
                    return buffer.ToArray();
                }
                comments = await DanmakuXml.ReadAsync(stream, token);
                if (comments.Count == 0) state = "empty";
            }
            catch (FileNotFoundException) { state = "missing"; }
            catch (DirectoryNotFoundException) { state = "missing"; }
            catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException or System.Xml.XmlException or ArgumentException)
            { state = "invalid"; }
            if (action == "download") throw new ApiAccessException(409, "XML_UNAVAILABLE", "XML 不存在、不可读或超过大小限制");
            if (action == "verify")
                await records.MutateAsync(items =>
                {
                    var index = items.FindIndex(r => r.RecordId == recordId);
                    if (index >= 0) items[index] = items[index] with { CommentCount = comments.Count,
                        RefreshState = "verify-" + state, UpdatedAt = DateTimeOffset.UtcNow };
                }, token);
            return new { XmlPath = path, State = state, CommentCount = state is "valid" or "empty" ? (int?)comments.Count : null,
                Comments = comments.Take(30).Select(c => new { c.Text, c.Time }).ToArray() };
        }
        finally { _gate.Release(); }
    }
}
