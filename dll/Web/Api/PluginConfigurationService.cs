namespace DD.Danmaku.Web.Api;

/// <summary>只暴露管理字段；媒体旁车本地化默认关闭。</summary>
public sealed record PluginConfigDto(
    bool AutoInjectionEnabled,
    bool EdeResourceEnabled,
    string ResourceVersion,
    string LogLevel,
    bool AutoRefreshOnNextPlayback,
    bool FilePersistenceEnabled = false,
    bool? AiEnabled = null,
    bool? AiUserAccessEnabled = null,
    string[]? AiAllowedUserIds = null,
    string? MatchStrategy = null,
    bool? AllowMatchFallback = null);

public interface IPluginConfigurationService
{
    PluginConfigDto Get();
    PluginConfigDto Update(PluginConfigDto requested);
}

public sealed class PluginConfigurationService : IPluginConfigurationService
{
    private readonly Func<PluginConfiguration> _getConfiguration;
    private readonly Action<PluginConfiguration>? _saveConfiguration;
    // 本插件各管理配置接口共享锁，避免不同设置入口读改写丢失更新。
    internal static readonly object ConfigurationGate = new();
    private object _gate => ConfigurationGate;

    // 保留业务层独立使用方式；宿主必须使用带 getter/saver 的构造函数。
    public PluginConfigurationService(PluginConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        _getConfiguration = () => configuration;
    }

    public PluginConfigurationService(Func<PluginConfiguration> getConfiguration,
        Action<PluginConfiguration> saveConfiguration)
    {
        _getConfiguration = getConfiguration ?? throw new ArgumentNullException(nameof(getConfiguration));
        _saveConfiguration = saveConfiguration ?? throw new ArgumentNullException(nameof(saveConfiguration));
    }

    public PluginConfigDto Get()
    {
        lock (_gate) return ToDto(_getConfiguration());
    }

    public PluginConfigDto Update(PluginConfigDto requested)
    {
        ArgumentNullException.ThrowIfNull(requested);
        lock (_gate)
        {
            // 每次读取宿主当前配置，避免 Emby 替换配置对象后仍引用旧实例。
            var allowedIds = requested.AiAllowedUserIds is null ? null : NormalizeUserIds(requested.AiAllowedUserIds);
            var current = _getConfiguration();
            var configuration = _saveConfiguration is null ? current : current.CopyForUpdate();
            // 旧客户端省略 AI 字段时保留原值；名单以新数组替换，不修改宿主旧配置。
            configuration.AiEnabled = requested.AiEnabled ?? current.AiEnabled;
            configuration.AiUserAccessEnabled = requested.AiUserAccessEnabled ?? current.AiUserAccessEnabled;
            if (allowedIds is not null) configuration.AiAllowedUserIds = allowedIds;
            configuration.AutoInjectionEnabled = requested.AutoInjectionEnabled;
            configuration.EdeResourceEnabled = requested.EdeResourceEnabled;
            configuration.ResourceVersion = string.IsNullOrWhiteSpace(requested.ResourceVersion)
                ? configuration.ResourceVersion : requested.ResourceVersion.Trim();
            configuration.LogLevel = requested.LogLevel is "Warning" or "Error" ? requested.LogLevel : "Information";
            configuration.AutoRefreshOnNextPlayback = requested.AutoRefreshOnNextPlayback;
            configuration.FilePersistenceEnabled = requested.FilePersistenceEnabled;
            // 读写策略由独立联动设置维护，保存其他配置不得隐式开启写入。
            configuration.FilePersistenceName = ".xml";
            configuration.FilePersistenceFallback = false;
            var strategy = requested.MatchStrategy is "traditional-first" or "ai-first"
                ? requested.MatchStrategy : current.MatchStrategy;
            configuration.MatchStrategy = strategy is "traditional-first" or "ai-first"
                ? strategy : "traditional-first";
            configuration.AllowMatchFallback = requested.AllowMatchFallback ?? current.AllowMatchFallback;
            // 保存失败向调用者抛出，不伪报成功；不使用自建 JSON 配置文件。
            _saveConfiguration?.Invoke(configuration);
            return ToDto(_getConfiguration());
        }
    }

    private static string[] NormalizeUserIds(string[] ids)
    {
        if (ids.Length > 10000) throw new ArgumentException("授权用户数量过多");
        return ids.Select(id =>
        {
            if (id is null || !(Guid.TryParseExact(id, "N", out var guid)
                || Guid.TryParseExact(id, "D", out guid)) || guid == Guid.Empty)
                throw new ArgumentException("授权用户标识必须为有效 GUID");
            return guid.ToString("N");
        }).Distinct(StringComparer.Ordinal).ToArray();
    }

    private static PluginConfigDto ToDto(PluginConfiguration configuration) => new(
        configuration.AutoInjectionEnabled, configuration.EdeResourceEnabled,
        configuration.ResourceVersion, configuration.LogLevel,
        configuration.AutoRefreshOnNextPlayback, configuration.FilePersistenceEnabled,
        configuration.AiEnabled, configuration.AiUserAccessEnabled,
        (configuration.AiAllowedUserIds ?? []).ToArray(),
        configuration.MatchStrategy, configuration.AllowMatchFallback);
}

