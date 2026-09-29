namespace DD.Danmaku.Hosting;

using DD.Danmaku.Web.Api;
using MediaBrowser.Model.Services;
using MediaBrowser.Model.Tasks;

// 避开 Emby 对 dashboard 旧网页路径的兼容重写，业务接口使用独立路径。
[Route("/dd-danmaku/api/overview", "GET")]
public sealed class DashboardRequest { }
[Route("/dd-danmaku/api/library-scan/run", "POST")]
public sealed class StartLibraryScanRequest { }
[Route("/dd-danmaku/api/library-scan/run", "DELETE")]
public sealed class CancelLibraryScanRequest { }
[Route("/dd-danmaku/api/library-scan/mode", "PUT")]
public sealed class ScanModeRequest : IRequiresRequestStream
{
    public Stream RequestStream { get; set; } = Stream.Null;
}

public sealed partial class DanmakuApiService
{
    public Task<object> Get(DashboardRequest request) => Execute((user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        // 概览只返回非敏感配置及生效条件，不把配置完成冒充连通性检查。
        var c = plugin.Configuration;
        return Task.FromResult(ApiHttpResult.Success(new
        {
            Scan = host.Scan.Snapshot(), Deep = c.ScanDeepEnabled,
            Version = ScriptVersion.Current,
            Overview = new
            {
                c.AutoInjectionEnabled, c.EdeResourceEnabled,
                XmlEnabled = c.FilePersistenceEnabled,
                XmlRead = c.FilePersistenceEnabled && c.FilePersistenceReadEnabled,
                XmlWrite = c.FilePersistenceEnabled && c.FilePersistenceWriteEnabled,
                PreferLocal = c.FilePersistenceEnabled && c.FilePersistenceReadEnabled && c.PreferLocalDanmaku,
                AutoSave = c.FilePersistenceEnabled && c.FilePersistenceWriteEnabled && c.AutoSaveDanmaku,
                c.AiEnabled, AiConfigured = host.AiProviderReady,
                AiUserAccess = c.AiEnabled && c.AiUserAccessEnabled,
                AiUserCount = (c.AiAllowedUserIds ?? []).Length,
                AiModel = c.GetAiEndpoint().Model
            }
        }));
    });
    public Task<object> Post(StartLibraryScanRequest request) => Execute((user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        // 统一由 Emby 排队执行，控制台与仪表盘共享同一任务生命周期。
        _tasks.QueueScheduledTask<ScanLibraryTask>();
        return Task.FromResult(ApiHttpResult.Success(host.Scan.Snapshot()));
    });
    public Task<object> Delete(CancelLibraryScanRequest request) => Execute((user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        _tasks.CancelIfRunning<ScanLibraryTask>();
        return Task.FromResult(ApiHttpResult.Success(host.Scan.Snapshot()));
    });
    public Task<object> Put(ScanModeRequest request) => Execute(async (user, plugin, host) =>
    {
        EmbyAccessControl.RequireAdministrator(user);
        var bytes = await ApiHttpResult.ReadBodyAsync(request.RequestStream, Request, 1024, "application/json");
        var mode = ApiHttpResult.Parse<ScanModeBody>(bytes);
        lock (PluginConfigurationService.ConfigurationGate)
        {
            var copy = plugin.Configuration.CopyForUpdate();
            copy.ScanDeepEnabled = mode.Deep;
            plugin.UpdateConfiguration(copy);
            return ApiHttpResult.Success(new { Deep = copy.ScanDeepEnabled });
        }
    });
    private sealed record ScanModeBody(bool Deep);
}

/// <summary>每天扫描一次；管理员可在 Emby 计划任务页调整或删除触发器。</summary>
public sealed class ScanLibraryTask : IScheduledTask
{
    public string Key => "DD.Danmaku.ScanLibrary";
    public string Name => "扫描 XML 弹幕覆盖情况";
    public string Description => "只读扫描视频及 STRM 旁边的同名 XML，模式由仪表盘开关决定。";
    public string Category => Plugin.PluginName;
    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers()
    {
        yield return new TaskTriggerInfo { Type = TaskTriggerInfo.TriggerDaily,
            TimeOfDayTicks = TimeSpan.FromHours(4).Ticks };
    }
    public async Task Execute(CancellationToken cancellationToken, IProgress<double> progress)
    {
        var plugin = Plugin.Instance;
        var host = plugin?.Host ?? throw new InvalidOperationException("插件尚未就绪");
        progress.Report(0);
        await host.Scan.Start(plugin!.Configuration.ScanDeepEnabled, cancellationToken, progress);
        cancellationToken.ThrowIfCancellationRequested();
        progress.Report(100);
    }
}
