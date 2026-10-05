namespace DD.Danmaku;

using DD.Danmaku.Hosting;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.IO;
using MediaBrowser.Model.Serialization;

/// <summary>Emby 插件入口；自身配置由宿主 XML 配置机制加载和保存。</summary>
public sealed partial class Plugin : BasePlugin<PluginConfiguration>, MediaBrowser.Model.Plugins.IHasWebPages
{
    /// <summary>插件在 Emby 中的固定唯一标识。</summary>
    public static readonly Guid PluginId = Guid.Parse("4b59d7ce-5a09-4f14-a5ca-0b9e9c8e53d7");
    /// <summary>插件显示名称。</summary>
    public const string PluginName = "DD-Danmaku";
    /// <summary>用于隔离本插件注入补丁的所有者标识。</summary>
    public const string OwnerId = "dd-danmaku-injection";
    private readonly object _lifecycleGate = new();

    /// <summary>宿主已创建的插件实例；初始化前为空。</summary>
    public static Plugin? Instance { get; private set; }
    /// <summary>返回固定插件标识。</summary>
    public override Guid Id => PluginId;
    /// <summary>返回插件显示名称。</summary>
    public override string Name => PluginName;
    /// <summary>返回宿主插件列表中的功能说明。</summary>
    public override string Description => "服务端弹幕管理与 Web 弹幕插件";
    /// <summary>与宿主接口解耦的生命周期及运行统计服务。</summary>
    public PluginService Service { get; } = new();
    internal EmbyHostServices? Host { get; private set; }
    // 全插件共享每用户存储实例，保证并发请求使用同一把文件锁。
    internal Persistence.UserParameterServices Parameters { get; }
    internal Persistence.UserDefaultsStore UserDefaults { get; }
    private readonly string _recordsDirectory;

    /// <summary>使用宿主路径与 XML 序列化器初始化配置及用户参数存储。</summary>
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        // 用户参数、默认值和索引统一归属插件目录；旧 DataPath 仅用于兼容迁移。
        var data = Path.Combine(applicationPaths.PluginConfigurationsPath, "DD.Danmaku");
        var legacyData = Path.Combine(applicationPaths.DataPath, "DD-Danmaku");
        Parameters = new Persistence.UserParameterServices(applicationPaths.PluginConfigurationsPath,
            Path.Combine(data, "Users"), Path.Combine(legacyData, "Users"));
        UserDefaults = new Persistence.UserDefaultsStore(Path.Combine(data, "UserDefaults"),
            Path.Combine(legacyData, "UserDefaults"));
        _recordsDirectory = Path.Combine(data, "Data");
        Instance = this;
    }

    internal void StartHost(ILibraryManager libraryManager, IFileSystem fileSystem,
        MediaBrowser.Model.Logging.ILogger logger)
    {
        lock (_lifecycleGate)
        {
            if (Host is not null) return;
            // 启动前持久化一次迁移；仅修改副本，保存失败不发布宿主或预先标记完成。
            lock (Web.Api.PluginConfigurationService.ConfigurationGate)
            {
                var current = Configuration;
                if (!current.AiCandidateLimitMigrated || !current.AutoSaveDanmakuMigrated)
                {
                    var migrated = current.CopyForUpdate();
                    // 首次升级仅迁移旧值 10；迁移后允许管理员重新选择 10。
                    if (!current.AiCandidateLimitMigrated)
                    {
                        if (migrated.AiMaxCandidates == 10) migrated.AiMaxCandidates = 200;
                        migrated.AiCandidateLimitMigrated = true;
                    }
                    // 默认开启不扩大授权，不修改 XML 总开关、写开关或白名单。
                    if (!current.AutoSaveDanmakuMigrated)
                    {
                        migrated.AutoSaveDanmaku = true;
                        migrated.AutoSaveDanmakuMigrated = true;
                    }
                    try { UpdateConfiguration(migrated); }
                    catch
                    {
                        // Emby SDK 先替换内存再写盘；失败恢复原实例，下一次启动才能重新执行迁移。
                        Configuration = current;
                        throw;
                    }
                    if (!current.AutoSaveDanmakuMigrated)
                        logger.Info("XML 自动保存默认策略已迁移为开启；仍按当前用户授权及总开关、写入开关判定。");
                }
            }
            // 将宿主原生日志传入匹配链路，不另建日志文件。
            var services = new EmbyHostServices(this, libraryManager, fileSystem, logger);
            try
            {
                // 初始化完成后才发布宿主；失败释放已经创建的 HTTP 提供者。
                services.InitializeRecords(_recordsDirectory);
                Service.Start(Configuration);
                Host = services;
            }
            catch { services.Dispose(); throw; }
        }
    }

    internal void StopHost()
    {
        lock (_lifecycleGate)
        {
            Host?.Dispose();
            Host = null;
            Service.Stop();
        }
    }
}
