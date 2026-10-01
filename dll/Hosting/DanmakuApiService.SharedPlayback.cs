namespace DD.Danmaku.Hosting;

using System.Net.Http;
using System.Text.Json;
using DD.Danmaku.Danmaku;
using DD.Danmaku.Web.Api;
using MediaBrowser.Controller.Entities;

public sealed partial class DanmakuApiService
{
    private async Task<PlaybackQueryDto> QuerySharedPlaybackAsync(string id, string? source,
        User user, Plugin plugin, EmbyHostServices host)
    {
        var token = Request.CancellationToken;
        // 先读取旧正文，任何刷新失败都不影响已可用的共享弹幕。
        var old = await host.Playback.QueryAsync(id, token, source);
        if (!old.Found) return old;
        string? reason;
        var config = plugin.Configuration;
        void Authorize()
        {
            var current = _access.Authenticate(Request);
            if (current.Id != user.Id) throw new ApiAccessException(403, "USER_CHANGED", "用户身份已变化");
            _access.RequireVideo(current, id);
            DanmakuWritePolicy.Require(current, plugin.Configuration, DanmakuWritePolicy.Operation.RefreshShared);
            var actualSource = source ?? "";
            if (SelectionUpstreamRevision(actualSource, config) != SelectionUpstreamRevision(actualSource, plugin.Configuration))
                throw new ApiAccessException(409, "UPSTREAM_CHANGED", "弹幕上游配置已变化");
        }
        try
        {
            reason = await host.Playback.RefreshSharedAsync(id, source, config.SharedDanmakuFreshHours, Authorize,
                metadata => FetchSelectionCommentsAsync(new SelectionContentIdentity(id, metadata.SourceId!,
                    metadata.SourceEpisodeId!, metadata.ChConvert!.Value, metadata.UpstreamRevision!),
                    user.Id, config, token), user.Id.ToString("N"), token);
            if (reason is null) return await host.Playback.QueryAsync(id, token, source);
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
        catch (Exception error) when (error is ApiAccessException or IOException or UnauthorizedAccessException
            or JsonException or HttpRequestException or OperationCanceledException or InvalidOperationException
            or ArgumentException or FormatException or OverflowException or KeyNotFoundException)
        {
            reason = error is ApiAccessException access ? access.Code : "SHARED_REFRESH_FAILED";
        }
        return old with { RefreshRequired = true, RefreshReason = reason };
    }
}
