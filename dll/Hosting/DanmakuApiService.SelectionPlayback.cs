namespace DD.Danmaku.Hosting;

using System.Net.Http;
using System.Text.Json;
using DD.Danmaku.Danmaku;
using DD.Danmaku.Web.Api;
using MediaBrowser.Controller.Entities;

public sealed partial class DanmakuApiService
{
    // 只编排已授权用户；显式来源查询保留现有共享文件行为。
    private async Task<PlaybackQueryDto> QueryUserPlaybackAsync(string id, string? source,
        User user, Plugin plugin, EmbyHostServices host)
    {
        var token = Request.CancellationToken;
        if (!plugin.Configuration.FilePersistenceEnabled || !plugin.Configuration.FilePersistenceReadEnabled)
            return await host.Playback.QueryAsync(id, token, source);
        if (!string.IsNullOrWhiteSpace(source))
            return await QuerySharedPlaybackAsync(id, source, user, plugin, host);
        var selection = await host.Selections.FindAsync(user.Id.ToString("N"), id, token);
        if (selection is null) return await QuerySharedPlaybackAsync(id, source, user, plugin, host);
        string? failure = null;
        try
        {
            var comments = await host.Selections.ReadFreshAsync(selection, token);
            if (comments is null)
            {
                void Authorize()
                {
                    var current = _access.Authenticate(Request);
                    if (current.Id != user.Id) throw new ApiAccessException(403, "USER_CHANGED", "用户身份已变化");
                    _access.RequireVideo(current, id);
                    DanmakuWritePolicy.Require(current, plugin.Configuration, DanmakuWritePolicy.Operation.Selection);
                    if (selection.Content.UpstreamRevision != SelectionUpstreamRevision(selection.Content.SourceId, plugin.Configuration))
                        throw new ApiAccessException(409, "UPSTREAM_CHANGED", "所选上游配置已变化");
                }
                // 协调器在等待后重新检查选择与新鲜度，避免并发播放重复抓取。
                comments = await host.Selections.RefreshAsync(selection, Authorize,
                    () => FetchSelectionCommentsAsync(selection.Content, user.Id, plugin.Configuration, token), token);
            }
            return new(id, true, comments.Select(c => new DanmakuCommentDto(c.Text, c.Time, c.Mode,
                c.Color, c.UserId, c.FontSize, c.Timestamp, c.Pool, c.Cid, c.Weight)).ToArray(),
                comments.Count, selection.SelectedAt, null, selection.Content.SourceId, false, null, "temporary", null);
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
        catch (Exception error) when (error is ApiAccessException or IOException or UnauthorizedAccessException
            or JsonException or HttpRequestException or OperationCanceledException or InvalidOperationException
            or ArgumentException or FormatException or OverflowException or KeyNotFoundException)
        {
            // 保留选择且不返回过期临时正文；本次回退共享，失败原因不泄露路径和凭据。
            failure = error is ApiAccessException access ? access.Code : "SELECTION_REFRESH_FAILED";
        }
        var shared = await host.Playback.QueryAsync(id, token);
        return shared with { RefreshRequired = true, RefreshReason = failure };
    }
}
