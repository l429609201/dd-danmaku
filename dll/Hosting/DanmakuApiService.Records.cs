namespace DD.Danmaku.Hosting;

using DD.Danmaku.Danmaku;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;

public sealed partial class DanmakuApiService
{
    // 列表只读索引与媒体元数据；筛选先于分页，不为过滤读取 XML。
    private async Task<ApiHttpResult> ListManagedRecords(User user, EmbyHostServices host, RecordsHttpRequest request)
    {
        EmbyAccessControl.RequireAdministrator(user);
        // 参数校验必须在遍历之前，空索引也不能接受非法季号。
        if (request.Page < 1 || request.PageSize is < 1 or > 200 || request.SeasonNumber is < 0
            || request.Keyword?.Length > 200 || request.Source?.Length > 64
            || request.MediaType is not (null or "" or "movie" or "episode" or "other" or "unlinked"))
            throw new ArgumentException("筛选或分页参数无效");
        var libraryName = _access.LibraryNameResolver();
        var media = new Dictionary<string, RecordMedia>();
        var result = new List<object>();
        var filtered = new List<(DanmakuRecord Record, RecordMedia Media, string State)>();
        foreach (var record in await host.Playback.RecordSnapshotAsync(Request.CancellationToken))
        {
            Request.CancellationToken.ThrowIfCancellationRequested();
            if (!media.TryGetValue(record.ItemId, out var info))
            {
                info = DescribeRecordMedia(user, record.ItemId, libraryName);
                media[record.ItemId] = info;
            }
            var source = JsonDanmakuRecordStore.GetEffectiveSource(record) ?? "";
            var state = !info.Available ? "unlinked" : record.RefreshState == "scan-unverified" ? "unverified"
                : record.RefreshState == "scan-noncanonical" ? "noncanonical"
                : record.RefreshState.StartsWith("verify-", StringComparison.Ordinal) ? record.RefreshState[7..]
                : record.CommentCount == 0 ? "empty" : "valid";
            if (!string.IsNullOrWhiteSpace(request.Keyword)
                && !($"{info.Title} {info.Episode} {info.Library} {record.ItemId}").Contains(request.Keyword.Trim(), StringComparison.OrdinalIgnoreCase)) continue;
            if (!string.IsNullOrWhiteSpace(request.Source) && !source.Contains(request.Source.Trim(), StringComparison.OrdinalIgnoreCase)) continue;
            // 兼容旧状态查询；异常汇总不包括空弹幕、未校验或可规范化文件。
            var requestedState = request.State == "scan-noncanonical" ? "noncanonical" : request.State;
            if (requestedState == "abnormal") { if (state is not ("invalid" or "missing" or "unlinked")) continue; }
            else if (!string.IsNullOrEmpty(requestedState) && requestedState != state) continue;
            if (!string.IsNullOrEmpty(request.MediaType) && request.MediaType != info.MediaType) continue;
            filtered.Add((record, info, state));
            // 季筛选使用当前 Emby 元数据，旧 XML 没有季号也可正确参与筛选。
            if (request.SeasonNumber is { } season)
            {
                if (season < 0) throw new ArgumentException("季编号不能为负数");
                var matched = info.Available && info.MediaType == "episode"
                    && _access.RequireVideoItem(user, record.ItemId) is Episode episode
                    && episode.ParentIndexNumber == season;
                if (!matched) filtered.RemoveAt(filtered.Count - 1);
            }
        }
        var offset = Math.Min(((long)request.Page - 1) * request.PageSize, int.MaxValue);
        foreach (var entry in filtered.OrderByDescending(e => e.Record.UpdatedAt).ThenBy(e => e.Record.RecordId, StringComparer.Ordinal)
            .Skip((int)offset).Take(request.PageSize))
        {
            var r = entry.Record;
            result.Add(new { r.RecordId, r.ItemId, entry.Media.Title, entry.Media.Episode, entry.Media.Library,
                entry.Media.Available, entry.Media.MediaId, entry.Media.MediaType, entry.State,
                Source = JsonDanmakuRecordStore.GetEffectiveSource(r),
                // 身份字段只作管理员展示，不从列表响应取得文件访问权限。
                r.OwnerUserId, r.OwnerUserName, r.UpdatedByUserId, r.WriteMethod, r.FetchedAt,
                SourceAnimeId = r.AnimeId, SourceEpisodeId = r.EpisodeId,
                r.SeasonNumber, r.EpisodeNumber,
                CommentCount = entry.State is "valid" or "empty" ? (int?)r.CommentCount : null, r.StoredAt, r.UpdatedAt });
        }
        return ApiHttpResult.Success(new { Items = result, Total = filtered.Count, request.Page, request.PageSize });
    }

    private sealed record RecordMedia(bool Available, string MediaId, string Title, string Episode, string Library, string MediaType);
    private RecordMedia DescribeRecordMedia(User user, string id, Func<string?, string> libraryName)
    {
        try
        {
            var item = _access.RequireVideoItem(user, id);
            var episode = item as Episode;
            return new(true, item.Id.ToString("N"), episode?.SeriesName ?? item.Name,
                episode is null ? "" : $"第{episode.ParentIndexNumber}季 第{episode.IndexNumber}集 · {item.Name}", libraryName(item.Path),
                episode is not null ? "episode" : item is MediaBrowser.Controller.Entities.Movies.Movie ? "movie" : "other");
        }
        catch (ApiAccessException error) when (error.Status == 404)
        { return new(false, "", "媒体不存在或不可访问", "", "未关联", "unlinked"); }
    }

    private static void RequireRecordRead(User user, Plugin plugin)
    {
        EmbyAccessControl.RequireAdministrator(user);
        if (!plugin.Configuration.FilePersistenceEnabled || !plugin.Configuration.FilePersistenceReadEnabled)
            throw new ApiAccessException(409, "XML_READ_DISABLED", "服务器 XML 读取未启用");
    }

    /// <summary>管理员查看已授权弹幕记录的详情。</summary>
    public Task<object> Get(RecordDetailRequest request) => Execute(async (user, plugin, host) =>
    {
        RequireRecordRead(user, plugin);
        string? mediaPath = null;
        var detail = await host.Playback.ManageRecordAsync(request.RecordId, "detail", id =>
        {
            var item = _access.RequireVideoItem(user, id);
            mediaPath = item.Path;
            return item.Id.ToString("N");
        }, Request.CancellationToken);
        return ApiHttpResult.Success(new { MediaPath = mediaPath, Detail = detail });
    });

    /// <summary>管理员校验记录关联的旁车文件。</summary>
    public Task<object> Post(VerifyRecordRequest request) => Execute(async (user, plugin, host) =>
    {
        RequireRecordRead(user, plugin);
        return ApiHttpResult.Success(await host.Playback.ManageRecordAsync(request.RecordId, "verify",
            id => _access.RequireVideo(user, id), Request.CancellationToken));
    });

    /// <summary>管理员将兼容 XML 重新写成统一 i/d/p 格式。</summary>
    public Task<object> Post(NormalizeRecordRequest request) => Execute(async (user, plugin, host) =>
    {
        RequireRecordRead(user, plugin);
        if (!plugin.Configuration.FilePersistenceWriteEnabled)
            throw new ApiAccessException(409, "XML_WRITE_DISABLED", "服务器 XML 写入未启用");
        return ApiHttpResult.Success(await host.Playback.ManageRecordAsync(request.RecordId, "normalize",
            id => _access.RequireVideo(user, id), Request.CancellationToken));
    });

    /// <summary>管理员移除记录索引或同时删除关联文件。</summary>
    public Task<object> Delete(RemoveRecordRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        if (request.DeleteFile && (!plugin.Configuration.FilePersistenceEnabled || !plugin.Configuration.FilePersistenceWriteEnabled))
            throw new ApiAccessException(409, "XML_WRITE_DISABLED", "服务器 XML 写入未启用");
        return ApiHttpResult.Success(await host.Playback.ManageRecordAsync(request.RecordId, request.DeleteFile ? "delete" : "remove",
            id => _access.RequireVideo(user, id), Request.CancellationToken));
    });

    /// <summary>管理员下载已授权记录的 XML 弹幕。</summary>
    public Task<object> Get(DownloadRecordRequest request) => Execute(async (user, plugin, host) =>
    {
        RequireRecordRead(user, plugin);
        var bytes = (byte[])await host.Playback.ManageRecordAsync(request.RecordId, "download",
            id => _access.RequireVideo(user, id), Request.CancellationToken);
        return new ApiHttpResult(200, bytes, "application/xml; charset=utf-8");
    });
}
