namespace DD.Danmaku;

/// <summary>共享持久化与用户选择缓存策略；默认不扩大普通用户的写入权限。</summary>
public sealed partial class PluginConfiguration
{
    /// <summary>共享正文超过此小时数后，仅在播放请求时尝试刷新。</summary>
    public int SharedDanmakuFreshHours { get; set; } = 24;
    /// <summary>临时正文新鲜度与默认保留小时数。</summary>
    public int TemporaryDanmakuHours { get; set; } = 24;
    /// <summary>用户明确选择的默认保留天数，播放不续期。</summary>
    public int DanmakuSelectionDays { get; set; } = 7;
    /// <summary>临时正文总容量上限，单位 MiB。</summary>
    public int TemporaryDanmakuLimitMiB { get; set; } = 512;
    /// <summary>每用户最多保留的选择条数，包含长期选择。</summary>
    public int DanmakuSelectionLimitPerUser { get; set; } = 100;
    /// <summary>允许创建和刷新本人临时选择的用户。</summary>
    public string[] DanmakuSelectionUserIds { get; set; } = [];
    /// <summary>允许创建缺失共享正文的用户。</summary>
    public string[] DanmakuCreateSharedUserIds { get; set; } = [];
    /// <summary>允许刷新共享同来源同集正文的用户。</summary>
    public string[] DanmakuRefreshSharedUserIds { get; set; } = [];
    /// <summary>允许显式替换共享来源或集绑定的用户。</summary>
    public string[] DanmakuReplaceSharedUserIds { get; set; } = [];
    /// <summary>允许上传共享正文的用户，不自动授予覆盖权限。</summary>
    public string[] DanmakuUploadSharedUserIds { get; set; } = [];
}
