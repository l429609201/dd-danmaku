namespace DD.Danmaku;

public sealed partial class PluginConfiguration
{
    /// <summary>GitHub API 凭据，只在服务端保存，不向管理页面回显。</summary>
    public string? GitHubToken { get; set; }
}
