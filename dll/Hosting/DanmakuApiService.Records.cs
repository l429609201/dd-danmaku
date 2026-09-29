namespace DD.Danmaku.Hosting;

using DD.Danmaku.Danmaku;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;

public sealed partial class DanmakuApiService
{
    // 列表仅关联索引中的媒体，不扫描旁车正文；同一媒体多来源复用元数据。
    private async Task<ApiHttpResult> ListManagedRecords(User user, EmbyHostServices host, RecordsHttpRequest request)
    {
        EmbyAccessControl.RequireAdministrator(user);
        if (request.Page < 1 || request.PageSize is < 1 or > 200
            || request.Keyword?.Length > 200 || request.Source?.Length > 64) throw new ArgumentException("筛选或分页参数无效");
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
                : record.RefreshState.StartsWith("verify-", StringComparison.Ordinal) ? record.RefreshState[7..]
                : record.CommentCount == 0 ? "empty" : "valid";
            if (!string.IsNullOrWhiteSpace(request.Keyword)
                && !($"{info.Title} {info.Episode} {info.Library} {record.ItemId}").Contains(request.Keyword.Trim(), StringComparison.OrdinalIgnoreCase)) continue;
            if (!string.IsNullOrWhiteSpace(request.Source) && !source.Contains(request.Source.Trim(), StringComparison.OrdinalIgnoreCase)) continue;
            if (!string.IsNullOrEmpty(request.State) && request.State != state) continue;
            filtered.Add((record, info, state));
        }
        var offset = Math.Min(((long)request.Page - 1) * request.PageSize, int.MaxValue);
        foreach (var entry in filtered.OrderByDescending(e => e.Record.UpdatedAt).ThenBy(e => e.Record.RecordId, StringComparer.Ordinal)
            .Skip((int)offset).Take(request.PageSize))
        {
            var r = entry.Record;
            result.Add(new { r.RecordId, r.ItemId, entry.Media.Title, entry.Media.Episode, entry.Media.Library,
                entry.Media.Available, entry.Media.MediaId, entry.State,
                Source = JsonDanmakuRecordStore.GetEffectiveSource(r),
                CommentCount = entry.State is "valid" or "empty" ? (int?)r.CommentCount : null, r.StoredAt, r.UpdatedAt });
        }
        return ApiHttpResult.Success(new { Items = result, Total = filtered.Count, request.Page, request.PageSize });
    }

    private sealed record RecordMedia(bool Available, string MediaId, string Title, string Episode, string Library);
    private RecordMedia DescribeRecordMedia(User user, string id, Func<string?, string> libraryName)
    {
        try
        {
            var item = _access.RequireVideoItem(user, id);
            var episode = item as Episode;
            return new(true, item.Id.ToString("N"), episode?.SeriesName ?? item.Name,
                episode is null ? "" : $"第{episode.ParentIndexNumber}季 第{episode.IndexNumber}集 · {item.Name}", libraryName(item.Path));
        }
        catch (ApiAccessException error) when (error.Status == 404)
        { return new(false, "", "媒体不存在或不可访问", "", "未关联"); }
    }

    private static void RequireRecordRead(User user, Plugin plugin)
    {
        EmbyAccessControl.RequireAdministrator(user);
        if (!plugin.Configuration.FilePersistenceEnabled || !plugin.Configuration.FilePersistenceReadEnabled)
            throw new ApiAccessException(409, "XML_READ_DISABLED", "服务器 XML 读取未启用");
    }

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

    public Task<object> Post(VerifyRecordRequest request) => Execute(async (user, plugin, host) =>
    {
        RequireRecordRead(user, plugin);
        return ApiHttpResult.Success(await host.Playback.ManageRecordAsync(request.RecordId, "verify",
            id => _access.RequireVideo(user, id), Request.CancellationToken));
    });

    public Task<object> Delete(RemoveRecordRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        if (request.DeleteFile && (!plugin.Configuration.FilePersistenceEnabled || !plugin.Configuration.FilePersistenceWriteEnabled))
            throw new ApiAccessException(409, "XML_WRITE_DISABLED", "服务器 XML 写入未启用");
        return ApiHttpResult.Success(await host.Playback.ManageRecordAsync(request.RecordId, request.DeleteFile ? "delete" : "remove",
            id => _access.RequireVideo(user, id), Request.CancellationToken));
    });

    public Task<object> Get(DownloadRecordRequest request) => Execute(async (user, plugin, host) =>
    {
        RequireRecordRead(user, plugin);
        var bytes = (byte[])await host.Playback.ManageRecordAsync(request.RecordId, "download",
            id => _access.RequireVideo(user, id), Request.CancellationToken);
        return new ApiHttpResult(200, bytes, "application/xml; charset=utf-8");
    });
}
