namespace DD.Danmaku.Danmaku;

/// <summary>保存媒体关联、存储位置、访问时间及刷新策略的弹幕索引记录。</summary>
/// <param name="RecordId">记录唯一标识。</param>
/// <param name="ItemId">Emby 媒体条目标识。</param>
/// <param name="AnimeId">来源中的作品标识，未知时为空。</param>
/// <param name="EpisodeId">来源中的剧集标识，未知时为空。</param>
/// <param name="Source">弹幕来源名称。</param>
/// <param name="CommentCount">保存的弹幕条数。</param>
/// <param name="ContentHash">弹幕内容摘要。</param>
/// <param name="StoredAt">首次存储时间。</param>
/// <param name="UpdatedAt">最近更新时间。</param>
/// <param name="LastRequestedAt">最近请求时间，未请求时为空。</param>
/// <param name="LastPlayedAt">最近记录的播放时间。</param>
/// <param name="RefreshOnNextPlayback">是否要求下次播放刷新。</param>
/// <param name="RefreshAfter">允许刷新或判定过期的时间阈值。</param>
/// <param name="RefreshState">刷新状态标识。</param>
/// <param name="StorageLocation">弹幕文件存储位置。</param>
/// <param name="FormatVersion">索引数据格式版本。</param>
public sealed record DanmakuRecord(
    string RecordId,
    string ItemId,
    string? AnimeId,
    string? EpisodeId,
    string? Source,
    int CommentCount,
    string? ContentHash,
    DateTimeOffset StoredAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? LastRequestedAt,
    DateTimeOffset? LastPlayedAt,
    bool RefreshOnNextPlayback,
    DateTimeOffset? RefreshAfter,
    string RefreshState,
    string StorageLocation,
    int FormatVersion)
{
    // 扩展使用可空属性，旧索引反序列化后保持未知，不猜测历史归属。
    /// <summary>个人文件所有者；共享文件为空。</summary>
    public string? OwnerUserId { get; init; }
    /// <summary>保存时的所有者显示名，不作为授权依据。</summary>
    public string? OwnerUserName { get; init; }
    /// <summary>最近写入者的宿主认证标识。</summary>
    public string? UpdatedByUserId { get; init; }
    /// <summary>最近写入方式。</summary>
    public string? WriteMethod { get; init; }
    /// <summary>内容获取时间；规范化不刷新此值。</summary>
    public DateTimeOffset? FetchedAt { get; init; }
    /// <summary>所属季编号。</summary>
    public int? SeasonNumber { get; init; }
    /// <summary>所属集编号。</summary>
    public int? EpisodeNumber { get; init; }
}

/// <summary>提供弹幕索引的媒体查询、分页及刷新标记维护。</summary>
public interface IDanmakuRecordService
{
    /// <summary>按媒体标识查找索引；没有记录时返回空值。</summary>
    Task<DanmakuRecord?> GetByItemIdAsync(string itemId, CancellationToken cancellationToken);
    /// <summary>按指定页码和每页数量读取记录。</summary>
    Task<IReadOnlyList<DanmakuRecord>> ListAsync(int page, int pageSize, CancellationToken cancellationToken);
    /// <summary>设置指定记录的下次播放刷新标记。</summary>
    Task SetRefreshOnNextPlaybackAsync(string recordId, bool value, CancellationToken cancellationToken);
    /// <summary>删除指定索引记录，不代表已删除关联弹幕文件。</summary>
    Task DeleteAsync(string recordId, CancellationToken cancellationToken);
}

/// <summary>在经过授权的媒体路径上读写旁路弹幕文件。</summary>
public interface ISidecarStorageService
{
    /// <summary>解析媒体对应的授权存储路径；不可用时返回空值。</summary>
    Task<string?> ResolveAuthorizedPathAsync(string itemId, CancellationToken cancellationToken);
    /// <summary>读取记录对应的旁路文件并解析为弹幕集合。</summary>
    Task<IReadOnlyList<DanmakuComment>> ReadAsync(DanmakuRecord record, CancellationToken cancellationToken);
    /// <summary>以原子文件替换方式保存弹幕集合。</summary>
    Task WriteAtomicallyAsync(DanmakuRecord record, IReadOnlyList<DanmakuComment> comments, CancellationToken cancellationToken);
    /// <summary>删除记录关联且通过路径检查的旁路文件。</summary>
    Task DeleteAsync(DanmakuRecord record, CancellationToken cancellationToken);
    /// <summary>检查当前授权路径是否与记录保存的位置一致。</summary>
    Task<bool> ValidatePathFingerprintAsync(DanmakuRecord record, CancellationToken cancellationToken);
}

/// <summary>表示供 XML 存储及播放使用的单条弹幕。</summary>
/// <param name="Text">弹幕正文。</param>
/// <param name="Time">在视频时间轴上的出现时间，单位为秒。</param>
/// <param name="Mode">弹幕显示模式编码。</param>
/// <param name="Color">弹幕颜色的整数编码。</param>
/// <param name="UserId">来源提供的发送者标识，可为空。</param>
/// <param name="FontSize">Bilibili p 属性中的字号。</param>
/// <param name="Timestamp">Bilibili p 属性中的发送时间戳。</param>
/// <param name="Pool">Bilibili p 属性中的弹幕池编号。</param>
/// <param name="Cid">来源弹幕 ID，可为空。</param>
/// <param name="Weight">来源权重字段，Bilibili 标准中通常为 0。</param>
public sealed record DanmakuComment(string Text, double Time, int Mode, int Color, string? UserId,
    int FontSize = 25, long Timestamp = 0, int Pool = 0, string? Cid = null, int Weight = 0);
