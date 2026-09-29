namespace DD.Danmaku;

/// <summary>
/// DLL 插件自身配置。前端用户参数仍由 ParameterPersistence 兼容层管理。
/// </summary>
public sealed partial class PluginConfiguration : MediaBrowser.Model.Plugins.BasePluginConfiguration
{
    /// <summary>扫描默认模式；关闭时只检查同名 XML 是否存在。</summary>
    public bool ScanDeepEnabled { get; set; }

    // 管理 API 修改副本后交给宿主保存，不先改动当前配置；数组不会在此路径中修改。
    internal PluginConfiguration CopyForUpdate() => (PluginConfiguration)MemberwiseClone();
    // 管理员默认值独立于用户主动保存的参数；写入时必须替换对象和数组。
    /// <summary>提供给所有用户的显示默认值，不覆盖用户主动保存的参数。</summary>
    public FrontendDefaults GlobalFrontendDefaults { get; set; } = new();
    /// <summary>按用户覆盖全局默认值的配置条目。</summary>
    public UserFrontendDefaults[] UserFrontendDefaults { get; set; } = [];
    /// <summary>是否请求启用自动引导注入；实际可用性取决于宿主接线。</summary>
    public bool AutoInjectionEnabled { get; set; } = true;
    /// <summary>是否开放内嵌 ede.js 资源。</summary>
    public bool EdeResourceEnabled { get; set; } = true;
    /// <summary>前端资源缓存版本标识。</summary>
    public string ResourceVersion { get; set; } = "1";
    /// <summary>是否请求记录注入诊断日志。</summary>
    public bool InjectionLoggingEnabled { get; set; } = false;
    /// <summary>配置的日志级别名称。</summary>
    public string LogLevel { get; set; } = "Information";
    /// <summary>弹幕文件持久化总开关。</summary>
    public bool FilePersistenceEnabled { get; set; } = false;
    /// <summary>是否允许读取已有弹幕文件。</summary>
    public bool FilePersistenceReadEnabled { get; set; } = true;
    /// <summary>是否允许保存弹幕文件。</summary>
    public bool FilePersistenceWriteEnabled { get; set; }
    /// <summary>旁路弹幕文件的命名配置，默认使用 XML 后缀。</summary>
    public string FilePersistenceName { get; set; } = ".xml";
    /// <summary>文件持久化回退策略开关。</summary>
    public bool FilePersistenceFallback { get; set; } = false;
    /// <summary>是否启用下次播放自动刷新策略。</summary>
    public bool AutoRefreshOnNextPlayback { get; set; }
    /// <summary>刷新时间阈值，单位为小时。</summary>
    public int RefreshAfterHours { get; set; } = 168;
    /// <summary>刷新失败时是否保留旧弹幕。</summary>
    public bool KeepOldDanmakuOnRefreshFail { get; set; } = true;
    /// <summary>AI 匹配总开关。</summary>
    public bool AiEnabled { get; set; }
    // AI 总开关优先；普通用户必须同时启用授权开关并命中名单，空名单不放行。
    /// <summary>是否允许名单内的普通用户使用 AI 匹配。</summary>
    public bool AiUserAccessEnabled { get; set; }
    /// <summary>获准使用 AI 的普通用户标识列表。</summary>
    public string[] AiAllowedUserIds { get; set; } = [];
    /// <summary>统一的 OpenAI 兼容接入；旧字段仅供升级迁移读取。</summary>
    public bool AiEndpointConfigured { get; set; }
    public string? AiBaseUrl { get; set; }
    public string? AiModel { get; set; }
    /// <summary>管理员补充的 AI 匹配偏好；为空时使用内置规则。</summary>
    public string? AiMatchPrompt { get; set; }
    /// <summary>统一接入凭据，仅在服务端保存，不向客户端回显。</summary>
    public string? AiApiKey { get; set; }

    // 保留统一端点及旧配置的迁移入口，避免配置声明遗漏破坏所有 AI 调用。
    internal (string? Url, string? Model, string? Key) GetAiEndpoint()
    {
        if (AiEndpointConfigured || !string.IsNullOrWhiteSpace(AiBaseUrl))
            return (AiBaseUrl, AiModel, AiApiKey);
        // 严格沿用旧顺序及远程许可，不因升级而向原先禁用的服务发送数据。
        foreach (var kind in AiProviderOrder ?? [])
        {
            var remote = kind == "remote";
            if (kind != "local" && !remote || remote && !AiAllowRemote) continue;
            var url = remote ? RemoteAiBaseUrl : LocalAiBaseUrl;
            var model = remote ? RemoteAiModel : LocalAiModel;
            var key = remote ? RemoteAiApiKey : null;
            if (!ValidAiEndpoint(url, model, key) || remote &&
                (string.IsNullOrWhiteSpace(key) || !url!.StartsWith("https://", StringComparison.OrdinalIgnoreCase))) continue;
            return (url, model, key);
        }
        return (null, null, null);
    }

    internal static bool ValidAiEndpoint(string? url, string? model, string? key)
        => !string.IsNullOrWhiteSpace(model) && model.Length <= 256 && !model.Any(char.IsControl)
            && (key is null || key.Length <= 2048 && !key.Any(char.IsControl))
            && url is { Length: <= 2048 } && Uri.TryCreate(url, UriKind.Absolute, out var uri)
            && uri.Scheme is "http" or "https" && uri.UserInfo.Length == 0
            && uri.Query.Length == 0 && uri.Fragment.Length == 0;

    /// <summary>AI 提供者尝试顺序。</summary>
    public string[] AiProviderOrder { get; set; } = ["local", "remote"];
    /// <summary>本地 AI 服务基础地址。</summary>
    public string? LocalAiBaseUrl { get; set; }
    /// <summary>本地 AI 模型名称。</summary>
    public string? LocalAiModel { get; set; }
    /// <summary>远程 AI 服务基础地址。</summary>
    public string? RemoteAiBaseUrl { get; set; }
    /// <summary>远程 AI 模型名称。</summary>
    public string? RemoteAiModel { get; set; }
    /// <summary>远程 AI 凭据，不得原样公开给客户端。</summary>
    public string? RemoteAiApiKey { get; set; }
    /// <summary>AI 请求超时时长，单位为秒。</summary>
    public int AiTimeoutSeconds { get; set; } = 15;
    /// <summary>AI 自动匹配的最低排序分阈值，不表示校准概率。</summary>
    public decimal AiConfidenceThreshold { get; set; } = 0.85m;
    /// <summary>单次 AI 请求允许的候选数量上限，默认 200，可配置为 1–1000。</summary>
    public int AiMaxCandidates { get; set; } = 200;
    /// <summary>候选上限迁移标记，防止升级后管理员设置的 10 被重复改写。</summary>
    public bool AiCandidateLimitMigrated { get; set; }
    /// <summary>是否允许使用远程 AI 提供者。</summary>
    public bool AiAllowRemote { get; set; }
    /// <summary>AI 缓存策略配置；是否生效取决于对应实现。</summary>
    public bool AiCacheEnabled { get; set; } = true;
    /// <summary>统一匹配入口的首选方式：traditional-first 或 ai-first。</summary>
    public string MatchStrategy { get; set; } = "traditional-first";
    /// <summary>首选方式无法确认或不可用时是否允许切换到另一种方式。</summary>
    public bool AllowMatchFallback { get; set; } = true;

}
