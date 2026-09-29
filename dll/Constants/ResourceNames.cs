namespace DD.Danmaku.Constants;

/// <summary>统一定义引导注入标记及插件内嵌资源的相对路径。</summary>
public static class ResourceNames
{
    /// <summary>标识已注入的引导脚本，供重复注入检查使用。</summary>
    public const string BootstrapMarker = "dd-danmaku-bootstrap:v1";
    /// <summary>内嵌弹幕前端脚本的相对资源路径。</summary>
    public const string EdeScript = "Resources/ede.js";
    /// <summary>内嵌管理页面及其静态文件的资源根路径。</summary>
    public const string AdminRoot = "Resources/Admin";
}
