namespace DD.Danmaku.Hosting;

using DD.Danmaku.Danmaku;
using DD.Danmaku.Web.Api;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.IO;

/// <summary>宿主组合根；只供已授权的内部调用使用，不自行注册 HTTP 路由。</summary>
internal sealed class EmbyHostServices : IDisposable
{
    private readonly Plugin _plugin;
    private readonly Matching.OpenAiCompatibleProvider _aiProvider;
    private readonly MediaSidecarPathResolver _paths;
    private int _disposed;

    internal IPluginConfigurationService Configuration { get; }
    internal DanmakuStorageService Storage { get; }
    internal ISidecarStorageService Sidecar { get; }
    internal Matching.MatchApiService Matches { get; }
    internal bool AiProviderReady => _aiProvider.IsAvailable;
    // 草稿仅用于本次管理员模型查询，不持久化或影响运行配置。
    internal Task<IReadOnlyList<string>> GetAiModelsAsync(CancellationToken token, PluginConfiguration? draft = null)
        => _aiProvider.GetModelsAsync(token, draft);


    private readonly ILibraryManager _library;
    internal LibraryScanCoordinator Scan { get; private set; } = null!;

    internal EmbyHostServices(Plugin plugin, ILibraryManager libraryManager, IFileSystem fileSystem,
        MediaBrowser.Model.Logging.ILogger logger)
    {
        _library = libraryManager;
        _plugin = plugin;
        var playbackFiles = new EmbyPlaybackFileResolver(libraryManager, fileSystem);
        _paths = new MediaSidecarPathResolver(playbackFiles.ResolveAsync, GetConfiguration);
        var files = new DanmakuFileService();
        Storage = new DanmakuStorageService(_paths, files);
        // 显式适配二参数委托，旁车配置继续使用默认来源路径。
        Sidecar = new SidecarStorageService((itemId, token) => _paths.ResolveAsync(itemId, token), files);
        Configuration = new PluginConfigurationService(GetConfiguration, SaveConfiguration);
        _aiProvider = new Matching.OpenAiCompatibleProvider(GetConfiguration);
        // 日志委托保持匹配业务与宿主 SDK 解耦，实际输出到 Emby 日志。
        Matches = new Matching.MatchApiService(new Matching.MatchService(new Matching.RuleMatcher(),
            new Matching.IntelligentMatcher(), new Matching.AiMatchService(GetConfiguration, _aiProvider),
            GetConfiguration, message => logger.Info("{0}", message), message => logger.Warn("{0}", message)));
        // 组合根启动清理并将取消注册到宿主生命周期，不进行定时抓取。
        var cleanupStop = new CancellationTokenSource();
        _cleanupStop = cleanupStop;
        _startCleanup = selections =>
        {
            var worker = new SelectionCleanupWorker(selections, logger);
            cleanupStop.Token.Register(worker.Dispose);
        };
    }

    private readonly CancellationTokenSource _cleanupStop;
    private readonly Action<DanmakuSelectionService> _startCleanup;
    internal LocalPlaybackService Playback { get; private set; } = null!;
    internal DanmakuSelectionService Selections { get; private set; } = null!;

    /// <summary>扫描与播放共享记录索引及操作锁，避免多个实例覆盖同一文件。</summary>
    internal void InitializeRecords(string dataDirectory)
    {
        // 所有请求复用唯一选择协调器，不能逐请求创建独立锁。
        Selections = new DanmakuSelectionService(Path.Combine(dataDirectory, "selections"), GetConfiguration);
        Playback = new LocalPlaybackService(_paths, new JsonDanmakuRecordStore(dataDirectory));
        Scan = new LibraryScanCoordinator(_library, dataDirectory, Playback);
        Scan.Load();
        _startCleanup(Selections);
    }

    internal async Task RequireLocalFileAsync(string itemId, CancellationToken token)
    {
        if (await _paths.ResolveAsync(itemId, token) is null)
            throw new ApiAccessException(409, "SIDECAR_UNAVAILABLE", "本地化未启用或媒体不支持本地旁车文件");
    }

    private PluginConfiguration GetConfiguration()
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        return _plugin.Configuration;
    }

    private void SaveConfiguration(PluginConfiguration configuration)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        _plugin.UpdateConfiguration(configuration);
    }

    // 卸载时取消后台扫描和临时缓存清理并释放提供者。
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        _cleanupStop.Cancel();
        _cleanupStop.Dispose();
        Scan?.Dispose();
        _aiProvider.Dispose();
    }
}
