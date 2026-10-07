namespace DD.Danmaku;

public sealed partial class PluginConfiguration
{
    /// <summary>是否启用 Emby 内置的自定义弹幕 API 代理。</summary>
    public bool DanmakuProxyEnabled { get; set; }
    /// <summary>稳定来源标识，独立于代理类型；空值只转发不自动保存。</summary>
    public string DanmakuProxySourceId { get; set; } = "";
    /// <summary>管理员配置的 API 前缀，例如 https://example.com/api/v2。</summary>
    public string DanmakuProxyBaseUrl { get; set; } = "";
    /// <summary>固定服务器类型：generic 或 Misaka_Danmu_Server。</summary>
    public string DanmakuProxyServerType { get; set; } = "generic";
    /// <summary>自定义上游 AppId，不转发 Emby 会话凭据。</summary>
    public string DanmakuProxyAppId { get; set; } = "";
    /// <summary>仅服务端使用的上游签名密钥。</summary>
    public string DanmakuProxyAppSecret { get; set; } = "";
    /// <summary>管理员明确授权的内网业务 API 前缀；用户参数不能开启此权限。</summary>
    public string[] BackendPrivateSourcePrefixes { get; set; } = [];
}
