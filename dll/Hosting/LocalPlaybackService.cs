namespace DD.Danmaku.Hosting;

using DD.Danmaku.Danmaku;
using DD.Danmaku.Web.Api;

/// <summary>已授权的 XML 与记录编排；正文是事实来源，索引失败明确报告部分提交。</summary>
internal sealed partial class LocalPlaybackService(MediaSidecarPathResolver paths,
    JsonDanmakuRecordStore records)
{
    // 单一宿主共享锁确保本插件保存/删除与查询顺序一致，不承诺外部进程写入一致性。
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly DanmakuFileService _files = new();

    internal async Task SaveAsync(string id, IReadOnlyList<DanmakuComment> comments, CancellationToken token,
        bool overwrite = false, string? source = null, DanmakuXmlMetadata? metadata = null,
        Action? authorize = null)
    {
        await _gate.WaitAsync(token);
        try
        {
            // 获取锁后重新检查在途请求的权限，落盘前由文件服务再次复查。
            authorize?.Invoke();
            var path = await RequirePathAsync(id, token, source);
            // 媒体与来源由已授权参数统一确定，不能由上传 XML 改写本地绑定。
            var writeMetadata = (metadata ?? new DanmakuXmlMetadata()) with
            { EmbyItemId = id, SourceId = NormalizeSource(source) };
            try { await _files.SaveWithMetadataAsync(path, comments, token, overwrite, writeMetadata, authorize); }
            catch (IOException) when (!overwrite && File.Exists(path))
            { throw new ApiAccessException(409, "XML_EXISTS", "已有 XML 弹幕，覆盖需要管理员明确确认"); }
            try
            {
                await records.MutateAsync(items =>
                {
                    var normalizedSource = NormalizeSource(source);
                    // 旧 upload 属于无来源文件，新 upload 属于独立来源文件，匹配规则与索引去重一致。
                    var index = items.FindIndex(r => r.ItemId == id
                        && string.Equals(JsonDanmakuRecordStore.GetEffectiveSource(r), normalizedSource, StringComparison.Ordinal));
                    var now = DateTimeOffset.UtcNow;
                    var recordId = normalizedSource is null ? id : id + "|" + normalizedSource;
                    // 来源作品/集 ID 与来源一起入索引，不能与 Emby ItemId 混用。
                    var record = new DanmakuRecord(recordId, id, writeMetadata.SourceAnimeId,
                        writeMetadata.SourceEpisodeId, normalizedSource, comments.Count, null,
                        index < 0 ? now : items[index].StoredAt, now, null, null, false, null,
                        "none", "sidecar", 1)
                    {
                        OwnerUserId = writeMetadata.OwnerUserId, OwnerUserName = writeMetadata.OwnerUserName,
                        UpdatedByUserId = writeMetadata.UpdatedByUserId, WriteMethod = writeMetadata.WriteMethod,
                        FetchedAt = writeMetadata.FetchedAt, SeasonNumber = writeMetadata.SeasonNumber,
                        EpisodeNumber = writeMetadata.EpisodeNumber
                    };
                    if (index < 0) items.Add(record); else items[index] = record;
                }, token);
            }
            catch (Exception) { throw PartialCommit(); }
        }
        finally { _gate.Release(); }
    }

    internal async Task DeleteAsync(string id, CancellationToken token, string? source = null)
    {
        await _gate.WaitAsync(token);
        try
        {
            // 配置关闭发生在本次路径解析后时，仍按已授权的路径完成本次操作。
            var path = await RequirePathAsync(id, token, source);
            await _files.DeleteAsync(path, token);
            var normalizedSource = NormalizeSource(source);
            // 删除只匹配文件对应的有效来源，不误删旧上传记录或其他来源记录。
            try { await records.MutateAsync(items => items.RemoveAll(r => r.ItemId == id
                && string.Equals(JsonDanmakuRecordStore.GetEffectiveSource(r), normalizedSource, StringComparison.Ordinal)), token); }
            catch (Exception) { throw PartialCommit(); }
        }
        finally { _gate.Release(); }
    }

    internal async Task<PlaybackQueryDto> QueryAsync(string id, CancellationToken token, string? source = null)
    {
        await _gate.WaitAsync(token);
        try
        {
            var path = await RequirePathAsync(id, token, source);
            // 正文解析结果需要在异常处理块之后构造响应。
            IReadOnlyList<DanmakuComment> comments;
            try
            {
                // 不用 File.Exists：缺失与合法空 XML 分开，权限错误不伪装成未找到。
                await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
                var info = new FileInfo(path);
                if (info.LinkTarget is not null || (info.Attributes & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("不允许读取链接旁车文件");
                if (stream.Length > DanmakuXml.MaxBytes) throw new IOException("服务器弹幕文件超过限制");
                comments = await DanmakuXml.ReadAsync(stream, token);
            }
            catch (FileNotFoundException) { return Result(id, false, []); }
            catch (DirectoryNotFoundException) { return Result(id, false, []); }
            catch (System.Xml.XmlException ex) { throw new IOException("服务器弹幕 XML 格式无效", ex); }
            catch (InvalidDataException ex) { throw new IOException("服务器弹幕 XML 内容无效", ex); }
            catch (ArgumentException ex) { throw new IOException("服务器弹幕 XML 字段无效", ex); }
            // 不依赖索引可用性，不将旧索引的计数、时间或匹配信息冒充当前文件元数据。
            return Result(id, true, comments);
        }
        finally { _gate.Release(); }
    }

    /// <summary>只枚举已授权媒体的同名旁车来源，不扫描其他媒体或触发下载。</summary>
    internal async Task<IReadOnlyList<string>> GetSourcesAsync(string id, CancellationToken token)
    {
        var path = await RequirePathAsync(id, token);
        var prefix = Path.GetFileNameWithoutExtension(path) + "_";
        var sources = new List<string>();
        // 不把媒体名放入通配符，避免名称含通配字符时扩大匹配范围。
        foreach (var file in Directory.EnumerateFiles(Path.GetDirectoryName(path)!, "*.xml"))
        {
            token.ThrowIfCancellationRequested();
            var name = Path.GetFileNameWithoutExtension(file);
            if (!name.StartsWith(prefix, StringComparison.Ordinal)) continue;
            var source = name[prefix.Length..];
            if (source.Length is 0 or > 64) continue;
            if (sources.Count >= 32)
                throw new ApiAccessException(413, "SOURCE_LIMIT", "弹幕来源超过单次读取上限");
            sources.Add(source);
        }
        sources.Sort(StringComparer.Ordinal);
        return sources;
    }

    // 扫描只合并实际发现的文件，不删除范围外记录；与播放保存/删除共用操作锁。
    internal async Task MergeScanAsync(IReadOnlyCollection<ScanRecordEntry> found,
        DateTimeOffset started, CancellationToken token)
    {
        await _gate.WaitAsync(token);
        try
        {
            await records.MutateAsync(items =>
            {
                var positions = items.Select((record, index) => (record, index)).ToDictionary(
                    entry => (entry.record.ItemId, JsonDanmakuRecordStore.GetEffectiveSource(entry.record)),
                    entry => entry.index);
                foreach (var entry in found)
                {
                    token.ThrowIfCancellationRequested();
                    // 提交前再次确认文件仍存在，避免扫描期间插件删除后恢复旧索引。
                    if (!File.Exists(entry.Path)) continue;
                    var key = (entry.ItemId, entry.Source);
                    if (positions.TryGetValue(key, out var index))
                    {
                        var previous = items[index];
                        if (previous.UpdatedAt >= started) continue;
                        // 快速扫描不覆盖已知计数；深度扫描刷新计数并保留既有业务信息。
                        if (entry.Count is int count)
                            items[index] = previous with { CommentCount = count, UpdatedAt = started,
                                // 深度扫描已重新解析正文，清除旧的校验异常标记。
                                RefreshState = !entry.IsCanonical ? "scan-noncanonical" : previous.RefreshState == "scan-unverified" || previous.RefreshState.StartsWith("verify-", StringComparison.Ordinal)
                                    ? "none" : previous.RefreshState };
                    }
                    else
                    {
                        var recordId = entry.Source is null ? entry.ItemId : entry.ItemId + "|" + entry.Source;
                        positions[key] = items.Count;
                        items.Add(new DanmakuRecord(recordId, entry.ItemId, null, null, entry.Source,
                            entry.Count ?? 0, null, started, started, null, null, false, null,
                            entry.Count is null ? "scan-unverified" : entry.IsCanonical ? "none" : "scan-noncanonical", "sidecar", 1));
                    }
                    // 扫描不将 XML 声称的所有者转成授权；这里只同步展示信息及来源配对。
                    if (entry.Metadata is { } metadata)
                    {
                        var position = positions[key];
                        var sameSource = string.Equals(metadata.SourceId, entry.Source, StringComparison.Ordinal);
                        items[position] = items[position] with
                        {
                            AnimeId = sameSource ? metadata.SourceAnimeId : null,
                            EpisodeId = sameSource ? metadata.SourceEpisodeId : null,
                            UpdatedByUserId = metadata.UpdatedByUserId, WriteMethod = metadata.WriteMethod,
                            FetchedAt = metadata.FetchedAt, SeasonNumber = metadata.SeasonNumber,
                            EpisodeNumber = metadata.EpisodeNumber
                        };
                    }
                }
                // 存储层统一校验容量并原子写入；超限抛错，扫描不能伪报完成。
            }, token);
        }
        finally { _gate.Release(); }
    }


    internal async Task<object> ListAsync(int page, int pageSize, CancellationToken token)
    {
        if (page < 1 || pageSize is < 1 or > 200) throw new ArgumentException("分页参数无效");
        await _gate.WaitAsync(token);
        try
        {
            var all = await records.LoadAsync(token);
            var offset = ((long)page - 1) * pageSize;
            var items = all.OrderByDescending(r => r.UpdatedAt).ThenBy(r => r.ItemId, StringComparer.Ordinal)
                .Skip((int)Math.Min(offset, int.MaxValue)).Take(pageSize).Select(r => new
                {
                    r.RecordId, r.ItemId,
                    // 快速扫描仅确认文件存在，未知条数不冒充零条。
                    CommentCount = r.RefreshState == "scan-unverified" ? (int?)null : r.CommentCount,
                    r.StoredAt, r.UpdatedAt, Source = JsonDanmakuRecordStore.GetEffectiveSource(r),
                    StorageLocation = "sidecar"
                }).ToArray();
            return new { Items = items, Page = page, PageSize = pageSize, Total = all.Count,
                HasMore = offset + items.Length < all.Count };
        }
        finally { _gate.Release(); }
    }

    private async Task<string> RequirePathAsync(string id, CancellationToken token, string? source = null)
        => await paths.ResolveAsync(id, token, source)
            ?? throw new ApiAccessException(409, "SIDECAR_UNAVAILABLE", "本地化未启用或媒体不支持本地旁车文件");


    private static string? NormalizeSource(string? source)
        => string.IsNullOrWhiteSpace(source) ? null : source.Trim();
    private static PlaybackQueryDto Result(string id, bool found, IReadOnlyList<DanmakuComment> comments)
        => new(id, found, comments.Select(c => new DanmakuCommentDto(c.Text, c.Time, c.Mode, c.Color, c.UserId)).ToArray(),
            comments.Count, null, null, null, false, null, found ? "sidecar" : null, null);

    private static ApiAccessException PartialCommit()
        => new(500, "INDEX_COMMIT_FAILED", "XML 操作已完成，但记录索引更新失败；未回滚 XML，请重试相同操作修复索引");
}
