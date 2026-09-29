namespace DD.Danmaku.Hosting;

using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Plugins;
using MediaBrowser.Model.IO;
using MediaBrowser.Model.Logging;

/// <summary>由 Emby 自动发现，通过构造函数注入宿主服务。</summary>
public sealed class ServerEntryPoint : IServerEntryPoint
{
    private readonly ILibraryManager _libraryManager;
    private readonly IFileSystem _fileSystem;
    private readonly ILogger _logger;
    private readonly object _gate = new();
    private Plugin? _plugin;
    private bool _disposed;

    /// <summary>接收宿主媒体库、文件系统与日志服务，尚不启动插件。</summary>
    public ServerEntryPoint(ILibraryManager libraryManager, IFileSystem fileSystem, ILogManager logManager)
    {
        _libraryManager = libraryManager;
        _fileSystem = fileSystem;
        // 日志分类与插件显示名称解耦，匹配和生命周期统一使用 DD.Danmaku。
        _logger = logManager.GetLogger("DD.Danmaku");
    }

    /// <summary>启动插件宿主服务；初始化失败时清理资源并记录脱敏错误。</summary>
    public void Run()
    {
        lock (_gate)
        {
            if (_disposed || _plugin is not null) return;
            var plugin = Plugin.Instance;
            if (plugin is null)
            {
                _logger.Error("DD.Danmaku 插件实例尚未初始化，跳过宿主服务启动。");
                return;
            }
            try
            {
                // 匹配与生命周期共用 Emby 原生日志入口，正文品牌名称也统一使用点号。
                plugin.StartHost(_libraryManager, _fileSystem, _logger);
                _plugin = plugin;
                var injectionReady = plugin.Configuration.AutoInjectionEnabled
                    && plugin.Configuration.EdeResourceEnabled;
                _logger.Info("DD.Danmaku 宿主、XML 文件与匹配服务已初始化；管理入口通过 IHasWebPages 提供，HTTP API 与静态资源路由由 Emby 自动发现。");
                if (injectionReady)
                    _logger.Info("DD.Danmaku 将在播放页 videoosd.js 请求中追加 ede.js 启动段；不接管 app.js、shortcuts.js，也不修改宿主文件。");
                else
                    _logger.Info("DD.Danmaku 自动注入未启用：自动注入或 ede.js 资源开关已关闭。");
            }
            catch (Exception ex)
            {
                plugin.StopHost();
                // 不把配置内容、凭据或媒体物理路径写入日志。
                _logger.Error("DD.Danmaku 宿主初始化失败，已停用本插件服务。异常类型：{0}", ex.GetType().Name);
            }
        }
    }

    /// <summary>幂等停止本入口启动的插件服务并释放引用。</summary>
    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
            _plugin?.StopHost();
            _plugin = null;
        }
    }
}
