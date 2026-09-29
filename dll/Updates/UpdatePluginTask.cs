namespace DD.Danmaku.Updates;

using System.Reflection;
using MediaBrowser.Common;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Model.Logging;
using MediaBrowser.Model.Tasks;

/// <summary>由 Emby 发现的每周自动更新任务；只提示重启，不主动重启服务器。</summary>
public sealed class UpdatePluginTask : IScheduledTask
{
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private readonly IApplicationHost _host;
    private readonly IApplicationPaths _paths;
    private readonly ILogger _logger;

    /// <summary>注入宿主服务，用于检查发行版并替换插件文件。</summary>
    public UpdatePluginTask(IApplicationHost host, IApplicationPaths paths, ILogManager logs)
    {
        _host = host;
        _paths = paths;
        _logger = logs.GetLogger("DD.Danmaku.Update");
    }

    /// <summary>计划任务的稳定标识。</summary>
    public string Key => "DD.Danmaku.UpdatePlugin";
    /// <summary>计划任务显示名称。</summary>
    public string Name => "自动更新 DD-Danmaku";
    /// <summary>任务用途及安装后的操作说明。</summary>
    public string Description => "按所选频道检查并更新包含管理页面及 ede.js 的 DLL，安装后需手动重启 Emby。";
    /// <summary>计划任务所属的插件分类。</summary>
    public string Category => Plugin.PluginName;

    /// <summary>为每周更新检查生成随机的默认触发时间。</summary>
    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers()
    {
        // 随机分散初次默认检查时间；用户可在 Emby 计划任务页面修改或移除触发器。
        yield return new TaskTriggerInfo
        {
            Type = TaskTriggerInfo.TriggerWeekly,
            DayOfWeek = (DayOfWeek)Random.Shared.Next(7),
            TimeOfDayTicks = TimeSpan.FromMinutes(Random.Shared.Next(96) * 15).Ticks
        };
    }

    /// <summary>执行正式版检查及安全替换，完成后通知管理员重启。</summary>
    public async Task Execute(CancellationToken cancellationToken, IProgress<double> progress)
    {
        await Gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        string? temporary = null;
        try
        {
            progress.Report(0);
            // 同时约束请求、流读取的总时长，取消时不替换已安装 DLL。
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            deadline.CancelAfter(TimeSpan.FromMinutes(5));
            var token = deadline.Token;
            using var client = new GitHubReleaseClient();
            var channel = Plugin.Instance?.Configuration.UpdateChannel is "test" ? "test" : "main";
            var release = await client.LatestAsync(channel, token).ConfigureAwait(false);
            var loaded = typeof(Plugin).Assembly.GetName().Version ?? new Version(0, 0);
            if (release is null || !release.IsTest && release.Version <= GitHubReleaseClient.Normalize(loaded))
            {
                _logger.Info("没有可安装的新 {0} 频道 DLL。", channel);
                progress.Report(100);
                return;
            }
            var target = Path.Combine(_paths.PluginsPath, GitHubReleaseClient.FileName);
            if (!File.Exists(target)) throw new IOException("未找到标准插件安装文件，停止自动更新。");
            // 重启之前内存仍为旧版本，磁盘可能已经安装更新，不能重复覆盖备份。
            var disk = AssemblyName.GetAssemblyName(target);
            if (disk.Name != "DD.Danmaku") throw new InvalidDataException("插件安装文件名称不匹配。");
            if (!release.IsTest && GitHubReleaseClient.Normalize(disk.Version ?? new Version(0, 0)) >= release.Version)
            {
                _host.NotifyPendingRestart();
                _logger.Info("磁盘中的插件已更新，等待手动重启 Emby。");
                progress.Report(100);
                return;
            }
            progress.Report(10);
            temporary = target + "." + Guid.NewGuid().ToString("N") + ".download";
            await client.DownloadAsync(release, temporary, token).ConfigureAwait(false);
            progress.Report(80);
            PluginPackageValidator.Validate(temporary, release);
            if (release.IsTest)
            {
                var candidate = AssemblyName.GetAssemblyName(temporary);
                if (candidate.Name != "DD.Danmaku" || GitHubReleaseClient.Normalize(candidate.Version ?? new Version(0, 0))
                    <= GitHubReleaseClient.Normalize(loaded))
                {
                    _logger.Info("test 频道没有比当前版本更新的 DLL。");
                    progress.Report(100);
                    return;
                }
            }
            token.ThrowIfCancellationRequested();
            // 同目录替换并保留旧文件；不截断加载中的 DLL，也不在失败后退回直接覆盖。
            // 若宿主/文件系统不支持替换，任务失败并保留原文件，管理员可手动更新。
            File.Replace(temporary, target, target + ".bak");
            temporary = null;
            _host.NotifyPendingRestart();
            _logger.Info("插件已更新至 {0}，旧版保留为 DD.Danmaku.dll.bak，请手动重启 Emby。", release.Version);
            progress.Report(100);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            _logger.Info("插件更新已取消。");
            throw;
        }
        catch (Exception error)
        {
            // 不把下载地址或网络响应正文写入日志；抛出使计划任务正确显示失败。
            _logger.Error("插件更新失败（{0}），请检查网络、发布附件和目录权限。", error.GetType().Name);
            throw;
        }
        finally
        {
            if (temporary is not null)
            {
                try { File.Delete(temporary); }
                catch (Exception) { _logger.Warn("未能清理更新临时文件，请检查插件目录权限。"); }
            }
            Gate.Release();
        }
    }
}
