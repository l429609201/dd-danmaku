namespace DD.Danmaku.Web.Api;

using DD.Danmaku.Danmaku;

/// <summary>
/// 播放查询服务：只编排记录读取和旁车读取，不负责匹配算法。
/// </summary>
public sealed class PlaybackService : IPlaybackService
{
    private readonly IDanmakuRecordService _records;
    private readonly ISidecarStorageService _storage;

    /// <summary>绑定弹幕记录和旁车存储服务。</summary>
    public PlaybackService(IDanmakuRecordService records, ISidecarStorageService storage)
    {
        _records = records;
        _storage = storage;
    }

    /// <summary>读取媒体记录及对应旁车弹幕。</summary>
    public async Task<PlaybackQueryDto> QueryAsync(string itemId, CancellationToken cancellationToken)
    {
        var record = await _records.GetByItemIdAsync(itemId, cancellationToken);
        if (record is null)
        {
            return new PlaybackQueryDto(itemId, false, [], 0, null, null, null, false, null, null, null);
        }

        var comments = await _storage.ReadAsync(record, cancellationToken);
        var refresh = record.RefreshOnNextPlayback ||
            (record.RefreshAfter is not null && record.RefreshAfter <= DateTimeOffset.UtcNow);
        var reason = refresh ? "记录已标记刷新或已过期" : null;
        var match = string.IsNullOrWhiteSpace(record.AnimeId) && string.IsNullOrWhiteSpace(record.EpisodeId)
            ? null
            : new MatchSummaryDto(record.AnimeId, record.EpisodeId, null, 1m, "stored");

        return new PlaybackQueryDto(
            itemId, true, comments.Select(ToDto).ToArray(), comments.Count,
            record.StoredAt, record.UpdatedAt, record.Source, refresh, reason,
            record.StorageLocation, match);
    }

    /// <summary>接收播放结果；当前不在查询服务中伪造写入。</summary>
    public Task RecordResultAsync(string itemId, PlaybackResultDto result, CancellationToken cancellationToken)
    {
        // 播放结果写入需要宿主事件模型；先保留接口，不在查询服务中伪造记录。
        return Task.CompletedTask;
    }

    private static DanmakuCommentDto ToDto(DanmakuComment comment) =>
        new(comment.Text, comment.Time, comment.Mode, comment.Color, comment.UserId,
            comment.FontSize, comment.Timestamp, comment.Pool, comment.Cid, comment.Weight);
}
