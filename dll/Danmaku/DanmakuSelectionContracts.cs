namespace DD.Danmaku.Danmaku;

/// <summary>正文身份包含可信上游版本，避免配置变更后复用另一上游正文。</summary>
internal sealed record SelectionContentIdentity(string ItemId, string SourceId, string SourceEpisodeId,
    int ChConvert, string UpstreamRevision);

/// <summary>用户选择与正文分离；长期选择保护所引用正文，不影响其他用户期限。</summary>
internal sealed record UserDanmakuSelection(string SelectionId, string UserId,
    SelectionContentIdentity Content, DateTimeOffset SelectedAt, DateTimeOffset? ExpiresAt,
    bool KeepForever, long Revision, string UpdatedByUserId)
{
    internal bool IsActive(DateTimeOffset now) => KeepForever || ExpiresAt is { } expires && expires > now;

    internal UserDanmakuSelection WithRetention(bool keepForever, int days, string actor, DateTimeOffset now)
    {
        if (days is < 1 or > 3650) throw new ArgumentOutOfRangeException(nameof(days));
        // 恢复默认仅重算保留期限，不更改明确选集时间或正文抓取时间。
        return this with { KeepForever = keepForever, ExpiresAt = keepForever ? null : now.AddDays(days),
            UpdatedByUserId = actor, Revision = checked(Revision + 1) };
    }
}

/// <summary>正文元数据不存客户端路径；文件位置由缓存键在专用目录内生成。</summary>
internal sealed record SelectionContentEntry(string CacheKey, SelectionContentIdentity Identity,
    DateTimeOffset FetchedAt, DateTimeOffset RetainUntil, DateTimeOffset LastAccessAt,
    long ByteLength, int CommentCount)
{
    internal bool IsFresh(DateTimeOffset now, int hours)
    {
        if (hours is < 1 or > 8760) throw new ArgumentOutOfRangeException(nameof(hours));
        // 将来时间不能被当成无限新鲜；读取与保留不会延长新鲜度。
        return FetchedAt <= now && now - FetchedAt < TimeSpan.FromHours(hours);
    }
}
