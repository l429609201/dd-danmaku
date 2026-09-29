namespace DD.Danmaku;

// 联动策略独立声明，用户参数仍由按认证身份隔离的参数服务管理。
public sealed partial class PluginConfiguration
{
    /// <summary>播放时优先查询服务器同名 XML；关闭时沿用网络匹配链路。</summary>
    public bool PreferLocalDanmaku { get; set; } = true;
    /// <summary>仅管理员播放时允许自动保存网络弹幕，且不覆盖已有 XML。</summary>
    public bool AutoSaveDanmaku { get; set; }
    /// <summary>空数组扫描所有媒体库，否则仅扫描所选媒体库。</summary>
    public string[] ScanLibraryIds { get; set; } = [];
}
