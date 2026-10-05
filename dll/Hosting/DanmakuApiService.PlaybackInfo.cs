namespace DD.Danmaku.Hosting;

using DD.Danmaku.Constants;
using DD.Danmaku.Web.Api;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Services;

/// <summary>读取与客户端已取得正文版本绑定的本地播放信息。</summary>
[Route(RouteNames.ApiPrefix + "/playback/{ItemId}/info", "GET")]
public sealed class LocalPlaybackInfoRequest
{
    /// <summary>宿主媒体标识。</summary>
    public string ItemId { get; set; } = "";
    /// <summary>必须显式提供，空串表示无来源共享文件。</summary>
    public string? Source { get; set; }
    /// <summary>正文实际存储位置：sidecar 或 temporary。</summary>
    public string StorageLocation { get; set; } = "";
    /// <summary>已读取正文的 SHA256 十六进制版本。</summary>
    public string ContentVersion { get; set; } = "";
}

public sealed partial class DanmakuApiService
{
    /// <summary>仅验证现有正文，不刷新上游，不修改选择或缓存。</summary>
    public Task<object> Get(LocalPlaybackInfoRequest request) => Execute(async (user, plugin, host) =>
    {
        if (Request.QueryString["Source"] is null || request.Source is null
            || request.StorageLocation is not ("sidecar" or "temporary")
            || request.ContentVersion is not { Length: 64 }
            || !request.ContentVersion.All(Uri.IsHexDigit))
            throw new ArgumentException("播放信息参数无效");
        var source = request.Source.Trim();
        if (source.Length > 64 || source.Any(c => char.IsControl(c) || "<>:\"/\\|?*".Contains(c)))
            throw new ArgumentException("弹幕来源名称无效");
        var item = _access.RequireVideoItem(user, request.ItemId);
        var id = item.Id.ToString("N");
        var token = Request.CancellationToken;
        PlaybackQueryDto playback;
        DD.Danmaku.Danmaku.UserDanmakuSelection? selected = null;
        if (request.StorageLocation == "sidecar")
        {
            // 显式读取指定来源，绝不进入共享自动刷新编排。
            try { playback = await host.Playback.QueryAsync(id, token, source); }
            catch (ApiAccessException e) when (e.Code == "SIDECAR_UNAVAILABLE") { throw PlaybackInfoChanged(); }
        }
        else
        {
            var selection = await host.Selections.FindAsync(user.Id.ToString("N"), id, token);
            if (selection is null || selection.Content.ItemId != id || selection.Content.SourceId != source)
                throw PlaybackInfoChanged();
            selected = selection;
            var comments = await host.Selections.ReadFreshAsync(selection, token, touchAccess: false);
            if (comments is null) throw PlaybackInfoChanged();
            playback = TemporaryPlayback(id, selection, comments);
            // 读取过程中本人选择被替换或移除时，不能返回旧选择的信息。
            if (await host.Selections.FindAsync(user.Id.ToString("N"), id, token) != selection)
                throw PlaybackInfoChanged();
        }
        if (!playback.Found || (playback.Source ?? "") != source
            || !string.Equals(playback.ContentVersion, request.ContentVersion, StringComparison.OrdinalIgnoreCase))
            throw PlaybackInfoChanged();
        // 最终返回前复查身份、媒体与总/读取开关，所有字段只取当前可见宿主实体。
        var current = _access.Authenticate(Request);
        if (current.Id != user.Id) throw new ApiAccessException(403, "USER_CHANGED", "用户身份已变化");
        item = _access.RequireVideoItem(current, id);
        if (!plugin.Configuration.FilePersistenceEnabled || !plugin.Configuration.FilePersistenceReadEnabled)
            throw new ApiAccessException(409, "XML_READ_DISABLED", "服务器 XML 读取未启用");
        if (selected is not null && await host.Selections.FindAsync(current.Id.ToString("N"), id, token) != selected)
            throw PlaybackInfoChanged();
        var (series, season) = VisiblePlaybackParents(item, current);
        var episode = item as Episode;
        var poster = series is not null && series.HasImage(ImageType.Primary, 0) ? PlaybackPoster(series, "series")
            : season is not null && season.HasImage(ImageType.Primary, 0) ? PlaybackPoster(season, "season")
            : item.HasImage(ImageType.Primary, 0) ? PlaybackPoster(item, "item") : null;
        return ApiHttpResult.Success(new LocalPlaybackInfoDto(id, playback.ContentVersion!, request.StorageLocation,
            playback.Source ?? "", PlaybackSourceName(playback.Source), series?.Name ?? item.Name,
            episode?.Name, episode?.ParentIndexNumber, episode?.IndexNumber,
            playback.Match?.AnimeId, playback.Match?.EpisodeId, poster));
    });

    private static ApiAccessException PlaybackInfoChanged()
        => new(409, "PLAYBACK_INFO_CHANGED", "本地弹幕或个人选择已变化，请重新读取正文");

    private static string PlaybackSourceName(string? source) => source switch
    {
        null or "" => "未标注来源",
        DD.Danmaku.Danmaku.DanmakuXmlMetadata.OfficialSource => "弹弹play",
        _ => source
    };

    private static PosterDto PlaybackPoster(BaseItem item, string level) => new(item.Id.ToString("N"), "Primary", level);

    // 只沿实际父链取可信关联，不用名称或外部提供者标识猜测系列。
    private static (Series? Series, Season? Season) VisiblePlaybackParents(BaseItem item, User user)
    {
        bool Visible(BaseItem parent) => parent.Id != Guid.Empty && parent.IsVisible(user) && parent.IsVisibleStandalone(user);
        if (item is not Episode episode) return (null, null);
        if (episode.Parent is Season season && Visible(season))
            return (season.Parent is Series series && Visible(series) ? series : null, season);
        return (episode.Parent is Series direct && Visible(direct) ? direct : null, null);
    }
}
