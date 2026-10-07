namespace DD.Danmaku.Hosting;

using DD.Danmaku.Web.Api;
using MediaBrowser.Controller.Entities;

public sealed partial class DanmakuApiService
{
    private Task<PlaybackQueryDto> QuerySharedPlaybackAsync(string id, string? source,
        User user, Plugin plugin, EmbyHostServices host)
    {
        // 自动播放始终只读共享文件，过期不能触发抓取或覆盖；管理写操作保留独立入口。
        return host.Playback.QueryAsync(id, Request.CancellationToken, source);
    }
}
