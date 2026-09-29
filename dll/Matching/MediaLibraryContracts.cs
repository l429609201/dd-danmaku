namespace DD.Danmaku.Matching;

/// <summary>媒体库适配层返回的媒体元数据，不作为弹幕候选生成来源。</summary>
/// <param name="ItemId">宿主媒体条目标识。</param>
/// <param name="Name">媒体标题。</param>
/// <param name="Path">宿主解析的媒体路径。</param>
/// <param name="SeriesName">所属系列名称。</param>
/// <param name="SeasonNumber">季编号，未知时为空。</param>
/// <param name="EpisodeNumber">集编号，未知时为空。</param>
/// <param name="ProviderIds">各元数据提供者对应的外部标识。</param>
public sealed record MediaLibraryItem(
    string ItemId,
    string? Name,
    string? Path,
    string? SeriesName,
    int? SeasonNumber,
    int? EpisodeNumber,
    IReadOnlyDictionary<string, string> ProviderIds);

/// <summary>隔离宿主媒体库查询，供播放读取与存储授权使用。</summary>
public interface IMediaLibraryAdapter
{
    /// <summary>按媒体标识读取元数据；条目不存在时返回空值。</summary>
    Task<MediaLibraryItem?> GetItemAsync(string itemId, CancellationToken cancellationToken);
    /// <summary>按关键词查询宿主媒体条目。</summary>
    Task<IReadOnlyList<MediaLibraryItem>> SearchAsync(string keyword, CancellationToken cancellationToken);
}

// 媒体库适配器留给播放读取/存储授权；匹配接口不通过它制造弹幕候选。
