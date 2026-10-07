namespace DD.Danmaku.Hosting;

using MediaBrowser.Model.Services;
using DD.Danmaku.Web.Api;

/// <summary>读取本人可见媒体的原始季集及当前有效映射。</summary>
[Route("/dd-danmaku/api/metadata/{ItemId}/mapping", "GET")]
public sealed class MetadataMappingRequest
{
    /// <summary>由 Emby 媒体可见性检查验证的媒体条目标识。</summary>
    public string ItemId { get; set; } = "";
}

/// <summary>读取本人可见媒体所属可信 Series 的 TMDB 集数组列表。</summary>
[Route("/dd-danmaku/api/metadata/{ItemId}/tmdb/groups", "GET")]
public sealed class MetadataEpisodeGroupsRequest
{
    /// <summary>由 Emby 媒体可见性检查验证的媒体条目标识。</summary>
    public string ItemId { get; set; } = "";
}

/// <summary>读取已关联到本人可见媒体的 TMDB 集数组详情。</summary>
[Route("/dd-danmaku/api/metadata/{ItemId}/tmdb/groups/{GroupId}", "GET")]
public sealed class MetadataEpisodeGroupRequest
{
    /// <summary>用于验证集数组归属的媒体条目标识。</summary>
    public string ItemId { get; set; } = "";
    /// <summary>必须为该媒体可信 Series 标记或集数组列表内的标识。</summary>
    public string GroupId { get; set; } = "";
}

/// <summary>校验本人已保存的 TMDB 配置，不接收密钥或网络目标。</summary>
[Route("/dd-danmaku/api/metadata/tmdb/validate", "GET")]
public sealed class MetadataConfigurationRequest { }

public sealed partial class DanmakuApiService
{
    // 作用域缓存键包含本人身份及有效配置摘要；静态实例仅共享有界缓存和安全连接池。
    private static readonly Lazy<BackendEpisodeMetadata> MetadataHttpClient = new(() => new BackendEpisodeMetadata());

    /// <summary>手动偏移优先，返回可信原始季集与映射结果，不返回配置凭据。</summary>
    public Task<object> Get(MetadataMappingRequest request) => Execute(async (user, plugin, host) =>
    {
        var token = Request.CancellationToken;
        token.ThrowIfCancellationRequested();
        var media = BackendMediaMetadataReader.Read(_access.RequireVideoItem(user, request.ItemId));
        var defaults = await BackendDefaultsAsync(plugin, user.Id, token).ConfigureAwait(false);
        var mapped = BackendMediaMetadataReader.ManualMapping(media, defaults.EpisodeOffsetRules);
        if (mapped is null)
        {
            var options = MetadataOptions.FromDefaults(defaults, user.Id, "metadata-routes-v1", plugin.Configuration);
            mapped = await MetadataHttpClient.Value.MapAsync(media.Mapping, options, token).ConfigureAwait(false);
        }
        return ApiHttpResult.Success(new { ItemId = media.Target.ItemId,
            Original = new { Season = media.Mapping.Season, Episode = media.Mapping.Episode }, Mapping = mapped });
    });

    /// <summary>电视剧标识只来自已授权媒体的可信 Series，不接受调用者指定 TMDB 标识。</summary>
    public Task<object> Get(MetadataEpisodeGroupsRequest request) => Execute(async (user, plugin, host) =>
    {
        var token = Request.CancellationToken;
        token.ThrowIfCancellationRequested();
        var media = BackendMediaMetadataReader.Read(_access.RequireVideoItem(user, request.ItemId));
        var tmdbId = RequireMetadataSeries(media);
        var defaults = await BackendDefaultsAsync(plugin, user.Id, token).ConfigureAwait(false);
        var options = MetadataOptions.FromDefaults(defaults, user.Id, "metadata-routes-v1", plugin.Configuration);
        var groups = await MetadataHttpClient.Value.GetEpisodeGroupsAsync(tmdbId, options, token).ConfigureAwait(false);
        return ApiHttpResult.Success(new { ItemId = media.Target.ItemId, Groups = groups });
    });

    /// <summary>详情请求先验证媒体权限和集数组关联，不能访问未关联的任意集数组。</summary>
    public Task<object> Get(MetadataEpisodeGroupRequest request) => Execute(async (user, plugin, host) =>
    {
        var token = Request.CancellationToken;
        token.ThrowIfCancellationRequested();
        var media = BackendMediaMetadataReader.Read(_access.RequireVideoItem(user, request.ItemId));
        if (!media.Mapping.IsEpisode) throw new ApiAccessException(404, "TMDB_GROUP_NOT_FOUND", "媒体未关联集数组");
        if (string.IsNullOrEmpty(request.GroupId) || request.GroupId.Length > 128
            || !request.GroupId.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_'))
            throw new ArgumentException("TMDB 集数组标识无效");
        var defaults = await BackendDefaultsAsync(plugin, user.Id, token).ConfigureAwait(false);
        var options = MetadataOptions.FromDefaults(defaults, user.Id, "metadata-routes-v1", plugin.Configuration);
        if (!string.Equals(media.Mapping.EpisodeGroupId, request.GroupId, StringComparison.Ordinal))
        {
            var groups = await MetadataHttpClient.Value.GetEpisodeGroupsAsync(RequireMetadataSeries(media), options, token)
                .ConfigureAwait(false);
            if (!groups.Any(group => group.Id == request.GroupId))
                throw new ApiAccessException(404, "TMDB_GROUP_NOT_FOUND", "集数组未关联到该媒体");
        }
        var detail = await MetadataHttpClient.Value.GetEpisodeGroupAsync(request.GroupId, options, token).ConfigureAwait(false);
        return ApiHttpResult.Success(new { ItemId = media.Target.ItemId, Group = detail });
    });

    /// <summary>仅探测本人已保存配置，返回固定验证结果而非密钥或上游配置正文。</summary>
    public Task<object> Get(MetadataConfigurationRequest request) => Execute(async (user, plugin, host) =>
    {
        var token = Request.CancellationToken;
        token.ThrowIfCancellationRequested();
        var defaults = await BackendDefaultsAsync(plugin, user.Id, token).ConfigureAwait(false);
        var options = MetadataOptions.FromDefaults(defaults, user.Id, "metadata-routes-v1", plugin.Configuration);
        var result = await MetadataHttpClient.Value.ValidateConfigurationAsync(options, token).ConfigureAwait(false);
        return ApiHttpResult.Success(result);
    });

    private static string RequireMetadataSeries(BackendMediaMetadata media)
    {
        if (!media.Mapping.IsEpisode || string.IsNullOrEmpty(media.Mapping.TmdbId))
            throw new ApiAccessException(409, "TMDB_SERIES_NOT_CONFIGURED", "媒体所属系列未配置 TMDB 标识");
        return media.Mapping.TmdbId;
    }
}
