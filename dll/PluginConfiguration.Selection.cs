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
    /// <summary>管理员是否允许保存 XML；关闭后不能借普通用户白名单绕过。</summary>
    public bool XmlAdministratorSaveEnabled { get; set; } = true;
    /// <summary>普通用户 XML 保存白名单；null 兼容旧创建与上传交集，空数组明确撤权。</summary>
    public string[]? XmlSaveUserIds { get; set; }
    /// <summary>是否允许覆盖已有 XML，管理员与普通用户均受此开关限制。</summary>
    public bool XmlOverwriteEnabled { get; set; }

    // 以下旧名单仅保留配置兼容性；选择不再按名单授权，保存仅在新名单为 null 时读取创建与上传交集。
    /// <summary>旧版本人临时选择名单，仅供兼容。</summary>
    public string[] DanmakuSelectionUserIds { get; set; } = [];
    /// <summary>旧版创建共享正文名单，仅用于兼容保存白名单。</summary>
    public string[] DanmakuCreateSharedUserIds { get; set; } = [];
    /// <summary>旧版刷新共享正文名单，仅供兼容，不再用于授权。</summary>
    public string[] DanmakuRefreshSharedUserIds { get; set; } = [];
    /// <summary>旧版替换共享正文名单，仅供兼容，不再用于授权。</summary>
    public string[] DanmakuReplaceSharedUserIds { get; set; } = [];
    /// <summary>旧版上传共享正文名单，仅用于兼容保存白名单。</summary>
    public string[] DanmakuUploadSharedUserIds { get; set; } = [];
}
