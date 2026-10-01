namespace DD.Danmaku.Web.Api;

using DD.Danmaku.Runtime;

// 由宿主按实际注册、就绪和当前用户权限填充；默认拒绝宣告能力。
/// <summary>宿主已注册、已就绪且当前用户有权使用的功能集合。</summary>
/// <param name="ApiReady">API 宿主是否就绪。</param>
/// <param name="LocalDanmaku">本地弹幕查询是否就绪。</param>
/// <param name="Sidecar">旁路文件服务是否就绪。</param>
/// <param name="BatchManagement">批量管理是否就绪。</param>
/// <param name="Statistics">统计接口是否就绪。</param>
/// <param name="RefreshPolicy">刷新策略是否就绪。</param>
/// <param name="MediaMatch">媒体匹配是否就绪。</param>
/// <param name="AiProviderReady">当前用户可用的 AI 提供者是否就绪。</param>
/// <param name="ParameterPersistence">参数兼容服务是否可用。</param>
public sealed record BackendReadiness(
    bool ApiReady = false, bool LocalDanmaku = false, bool Sidecar = false,
    bool BatchManagement = false, bool Statistics = false, bool RefreshPolicy = false,
    bool MediaMatch = false, bool AiProviderReady = false, bool ParameterPersistence = false);

/// <summary>结合真实就绪状态与配置生成客户端能力声明。</summary>
public sealed class CapabilitiesService
{
    private readonly Func<BackendReadiness> _readiness;
    /// <summary>注入就绪状态读取函数；未提供时默认不宣告能力。</summary>
    public CapabilitiesService(Func<BackendReadiness>? readiness = null)
        => _readiness = readiness ?? (() => new BackendReadiness());

    /// <summary>生成当前请求的能力快照，不把配置开启等同于功能已就绪。</summary>
    public CapabilitiesDto Create(PluginConfiguration configuration, RuntimeSnapshot snapshot)
    {
        var ready = _readiness();
        var capabilities = new Dictionary<string, bool>(StringComparer.Ordinal)
        {
            ["LocalDanmaku"] = ready.ApiReady && ready.LocalDanmaku,
            // 仅在宿主实时入口启动后宣告能力；订阅确认前前端仍使用本地事件。
            ["WebSocketPlayback"] = ready.ApiReady && Hosting.PlaybackSocketListener.Available,
            ["FileSidecarPersistence"] = ready.ApiReady && ready.Sidecar && configuration.FilePersistenceEnabled,
            ["BatchManagement"] = ready.ApiReady && ready.BatchManagement,
            ["Statistics"] = ready.ApiReady && ready.Statistics,
            ["RefreshPolicy"] = ready.ApiReady && ready.RefreshPolicy,
            ["MediaMatch"] = ready.ApiReady && ready.MediaMatch,
            ["OnlineMatch"] = ready.ApiReady && ready.MediaMatch,
            ["OperationEvents"] = ready.ApiReady && ready.MediaMatch,
            ["AiMatching"] = ready.ApiReady && ready.MediaMatch && ready.AiProviderReady && configuration.AiEnabled,
            ["ParameterPersistence"] = ready.ApiReady && ready.ParameterPersistence,
            ["Injection"] = snapshot.InjectionAvailable && snapshot.ResolvedPatch is not null
                && configuration.AutoInjectionEnabled
        };
        return new CapabilitiesDto("dd-danmaku",
            typeof(CapabilitiesService).Assembly.GetName().Version?.ToString() ?? "0.0.0",
            1, "dll", capabilities, ready.ApiReady,
            capabilities["FileSidecarPersistence"], ready.ApiReady && ready.RefreshPolicy && configuration.AutoRefreshOnNextPlayback);
    }
}
