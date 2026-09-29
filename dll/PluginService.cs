namespace DD.Danmaku;

using DD.Danmaku.Injection;
using DD.Danmaku.Runtime;

/// <summary>
/// 与 Emby 具体宿主接口解耦的插件生命周期骨架。
/// 目标 Emby 方法签名确认后，由宿主适配层调用 Start/Stop。
/// </summary>
public sealed class PluginService
{
    private readonly RuntimeStatistics _statistics = new();
    private DateTimeOffset _startedAt;
    private bool _started;

    /// <summary>获取线程安全的注入计数器。</summary>
    public RuntimeStatistics Statistics => _statistics;

    /// <summary>记录服务启动时间；重复调用不重复初始化，亦不代表注入已接通。</summary>
    public void Start(PluginConfiguration configuration)
    {
        if (_started) return;
        _startedAt = DateTimeOffset.UtcNow;
        _started = true;
        // Harmony 补丁必须等目标版本签名确认后，再由 Injection.PatchResolver 注册。
    }

    /// <summary>清除运行标记；重复停止不产生额外操作。</summary>
    public void Stop()
    {
        if (!_started) return;
        _started = false;
        // 这里只卸载 DD 自己的 Harmony owner，不能影响其他插件补丁。
    }

    /// <summary>结合配置、计数及可选错误信息创建只读运行快照。</summary>
    public RuntimeSnapshot Snapshot(PluginConfiguration configuration, string? lastError = null)
    {
        return new RuntimeSnapshot(
            // 宿主服务启动不代表 Harmony 已接入，不能误报注入可用。
            InjectionAvailable: false,
            ResolvedPatch: null,
            InjectionHits: _statistics.InjectionHits,
            InjectionSkipped: _statistics.InjectionSkipped,
            InjectionFailures: _statistics.InjectionFailures,
            ResourceVersion: configuration.ResourceVersion,
            StartedAt: _startedAt,
            LastError: lastError);
    }
}
