namespace DD.Danmaku;

using MediaBrowser.Model.Plugins;

public sealed partial class Plugin
{
    /// <summary>注册后台菜单和页面控制器；页面资源随 Vue 构建复制到内嵌资源目录。</summary>
    public IEnumerable<PluginPageInfo> GetPages()
    {
        yield return new PluginPageInfo
        {
            Name = "dd-danmaku", DisplayName = "DD 弹幕管理",
            EnableInMainMenu = true, MenuSection = "server", MenuIcon = "closed_caption",
            EmbeddedResourcePath = "DD.Danmaku.Resources/Admin/emby-page.html"
        };
        yield return new PluginPageInfo
        {
            Name = "dd-danmaku-bridge",
            EmbeddedResourcePath = "DD.Danmaku.Resources/Admin/emby-bridge.js"
        };
    }
}
