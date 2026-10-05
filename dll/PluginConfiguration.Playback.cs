namespace DD.Danmaku;

// 联动策略独立声明，用户参数仍由按认证身份隔离的参数服务管理。
public sealed partial class PluginConfiguration
{
    /// <summary>播放时优先查询服务器同名 XML；关闭时沿用网络匹配链路。</summary>
    public bool PreferLocalDanmaku { get; set; } = true;
    /// <summary>允许管理员或具备相应写入授权的用户自动保存网络弹幕，不覆盖已有 XML。</summary>
    public bool AutoSaveDanmaku { get; set; } = true;
    /// <summary>自动保存默认开启的一次迁移标记；迁移后保留管理员主动关闭的值。</summary>
    public bool AutoSaveDanmakuMigrated { get; set; }
    /// <summary>空数组扫描所有媒体库，否则仅扫描所选媒体库。</summary>
    public string[] ScanLibraryIds { get; set; } = [];
}
