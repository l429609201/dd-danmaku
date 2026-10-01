namespace DD.Danmaku.Danmaku;

/// <summary>XML 内的插件元数据；来源与集 ID 必须成对解释，不跨源复用。</summary>
internal sealed record DanmakuXmlMetadata
{
    internal const string OfficialSource = "dandanplay";
    public int Version { get; init; } = 1;
    // SourceId 标识实际弹幕供应方，不使用 DLL 代理地址或显示类型替代。
    public string? SourceId { get; init; }
    public string? SourceEpisodeId { get; init; }
    public string? SourceAnimeId { get; init; }
    // 旧文件缺失绑定时只读，不猜测上游身份或简繁转换方式。
    public string? UpstreamRevision { get; init; }
    public int? ChConvert { get; init; }
    // Emby 身份和上游身份分开保存；不能将来源集 ID 当作本地授权依据。
    public string? EmbyItemId { get; init; }
    public string? EmbySeriesId { get; init; }
    public string? EmbySeasonId { get; init; }
    public int? SeasonNumber { get; init; }
    public int? EpisodeNumber { get; init; }
    public string? OwnerUserId { get; init; }
    public string? OwnerUserName { get; init; }
    public string? UpdatedByUserId { get; init; }
    public string? WriteMethod { get; init; }
    // 写入时间由后端生成；读取旧文件时缺失仍为未知，不伪造新鲜度。
    public DateTimeOffset? UpdatedAt { get; init; }
    public DateTimeOffset? FetchedAt { get; init; }
}
