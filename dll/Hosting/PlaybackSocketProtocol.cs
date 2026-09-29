namespace DD.Danmaku.Hosting;

using System.Globalization;
using MediaBrowser.Controller.Library;

/// <summary>仅发送弹幕联动需要的播放信息，不序列化宿主用户、媒体或物理路径。</summary>
internal sealed record PlaybackSocketEvent(
    int ProtocolVersion,
    string ConnectionEpoch,
    long Sequence,
    string SessionId,
    string PlaySessionId,
    string ItemId,
    string ItemGuid,
    string Event,
    double? PositionSeconds,
    bool IsPaused,
    double? PlaybackRate,
    long Timestamp);

/// <summary>将已核对的 Emby 播放事件投影到专用协议；不推测客户端尚未上报的动作。</summary>
internal static class PlaybackSocketProtocol
{
    internal const int Version = 1;
    internal const string Subscribe = "DDDanmaku.Subscribe";
    internal const string Unsubscribe = "DDDanmaku.Unsubscribe";
    internal const string Heartbeat = "DDDanmaku.Heartbeat";
    internal const string State = "DDDanmaku.State";
    internal const string Ready = "DDDanmaku.Ready";

    internal static PlaybackSocketEvent? Project(PlaybackProgressEventArgs args,
        string eventName, string connectionEpoch, long sequence)
    {
        // 缺少明确的会话与媒体关联时不发送，避免把停止或切集消息应用到另一播放器。
        if (args.Session is null || args.Item is null
            || string.IsNullOrWhiteSpace(args.Session.Id)
            || string.IsNullOrWhiteSpace(args.PlaySessionId)
            || args.Item.InternalId <= 0 || args.Item.Id == Guid.Empty)
            return null;

        var ticks = args.PlaybackPositionTicks;
        return new PlaybackSocketEvent(Version, connectionEpoch, sequence,
            args.Session.Id, args.PlaySessionId,
            args.Item.InternalId.ToString(CultureInfo.InvariantCulture),
            args.Item.Id.ToString("N"), eventName,
            ticks.HasValue && ticks.Value >= 0 ? ticks.Value / 10000000d : null,
            args.IsPaused,
            // SDK 的倍速在会话状态中；未知或非法值不冒充正常一倍速。
            args.Session.PlayState is { PlaybackRate: var rate } && double.IsFinite(rate) && rate > 0
                ? rate : null,
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }

    internal static string ProgressName(PlaybackProgressEventArgs args)
    {
        // SDK 4.8.0.80 没有 Seek 枚举：位置更新只能称为状态同步，不能冒充精确跳转事件。
        return args.EventName switch
        {
            MediaBrowser.Model.Session.ProgressEvent.Pause => "paused",
            MediaBrowser.Model.Session.ProgressEvent.Unpause => "resumed",
            MediaBrowser.Model.Session.ProgressEvent.AudioTrackChange => "audioTrackChanged",
            MediaBrowser.Model.Session.ProgressEvent.PlaybackRateChange => "playbackRateChanged",
            _ => "state"
        };
    }
}
