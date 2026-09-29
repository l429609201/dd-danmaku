namespace DD.Danmaku;

public sealed partial class PluginConfiguration
{
    /// <summary>自动更新频道：main 为正式版，test 为 test-release 测试版。</summary>
    public string UpdateChannel { get; set; } = "main";
}
