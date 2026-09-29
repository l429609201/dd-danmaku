namespace DD.Danmaku.Web.Api;

/// <summary>
/// 宿主无关的 API 外观层。
/// Emby 版本适配器只需把 HTTP 请求转换为这些方法参数，避免业务服务依赖宿主类型。
/// </summary>
public sealed class ApiFacade
{
    private readonly CapabilitiesService _capabilities;
    private readonly IPluginConfigurationService _configuration;
    private readonly IPlaybackService _playback;
    private readonly IStatisticsService _statistics;
    private readonly Func<PluginConfiguration> _configurationProvider;
    private readonly Func<Runtime.RuntimeSnapshot> _snapshotProvider;

    public ApiFacade(
        CapabilitiesService capabilities,
        IPluginConfigurationService configuration,
        IPlaybackService playback,
        IStatisticsService statistics,
        Func<PluginConfiguration> configurationProvider,
        Func<Runtime.RuntimeSnapshot> snapshotProvider)
    {
        _capabilities = capabilities;
        _configuration = configuration;
        _playback = playback;
        _statistics = statistics;
        _configurationProvider = configurationProvider;
        _snapshotProvider = snapshotProvider;
    }

    // 宿主组合根需显式安装匹配端点；未接入时不能假装请求成功。
    private Matching.MatchApiService? _matches;
    public void ConfigureMatching(Matching.MatchApiService matches)
        => _matches = matches ?? throw new ArgumentNullException(nameof(matches));

    public Task<Matching.MatchHttpResult> ResolveMatchJsonAsync(
        ReadOnlyMemory<byte> utf8Body, CancellationToken cancellationToken)
        => _matches is not null ? _matches.ResolveJsonAsync(utf8Body, cancellationToken)
            : Task.FromResult(new Matching.MatchHttpResult(503,
                new ApiResponse<ResolveMatchResponse>(false, "匹配服务未接入", "MATCH_UNAVAILABLE",
                    null, Guid.NewGuid().ToString("N"))));


    public PluginConfigDto GetConfig() => _configuration.Get();

    public PluginConfigDto UpdateConfig(PluginConfigDto requested) => _configuration.Update(requested);

    public ApiResponse<CapabilitiesDto> GetCapabilities()
    {
        return new ApiResponse<CapabilitiesDto>(
            true, null, null,
            _capabilities.Create(_configurationProvider(), _snapshotProvider()), null);
    }

    public async Task<ApiResponse<PlaybackQueryDto>> GetPlaybackAsync(
        string itemId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(itemId))
            return new ApiResponse<PlaybackQueryDto>(false, "缺少 ItemId", "INVALID_ITEM_ID", null, null);

        var data = await _playback.QueryAsync(itemId, cancellationToken);
        return new ApiResponse<PlaybackQueryDto>(true, null, null, data, null);
    }

    public async Task<ApiResponse<object>> PostPlaybackResultAsync(
        string itemId, PlaybackResultDto result, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(itemId))
            return new ApiResponse<object>(false, "缺少 ItemId", "INVALID_ITEM_ID", null, null);

        await _playback.RecordResultAsync(itemId, result, cancellationToken);
        return new ApiResponse<object>(true, "播放结果已接收", null, null, null);
    }

    public async Task<ApiResponse<IReadOnlyDictionary<string, object>>> GetStatisticsAsync(
        CancellationToken cancellationToken)
    {
        var data = await _statistics.GetSummaryAsync(cancellationToken);
        return new ApiResponse<IReadOnlyDictionary<string, object>>(true, null, null, data, null);
    }
}
