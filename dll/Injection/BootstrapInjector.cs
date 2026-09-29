namespace DD.Danmaku.Injection;

/// <summary>判定请求路径是否为可注入的快捷键脚本。</summary>
public static class PathMatcher
{
    /// <summary>忽略查询参数并匹配快捷键模块路径。</summary>
    public static bool IsShortcutsResource(string? requestPath)
    {
        if (string.IsNullOrWhiteSpace(requestPath)) return false;
        var path = requestPath.Split('?', 2)[0]
            .Replace('\\', '/')
            .TrimStart('/')
            .ToLowerInvariant();
        return path == "modules/shortcuts.js" || path.EndsWith("/modules/shortcuts.js", StringComparison.Ordinal);
    }
}

/// <summary>向快捷键脚本追加弹幕插件的幂等引导代码。</summary>
public static class BootstrapInjector
{
    /// <summary>用于避免重复追加的引导标记。</summary>
    public const string Marker = "/* dd-danmaku-bootstrap:v1 */";

    /// <summary>仅在缺少标记时追加资源脚本加载器。</summary>
    public static string Append(string original, string resourceUrl)
    {
        if (original.Contains(Marker, StringComparison.Ordinal)) return original;
        return original + "\n" + Marker + "\n" +
            $";(function(){{if(window.__ddDanmakuBootstrapLoaded)return;window.__ddDanmakuBootstrapLoaded=true;var s=document.createElement('script');s.src='{resourceUrl}';s.charset='utf-8';s.onerror=function(){{window.__ddDanmakuBootstrapLoaded=false;}};(document.head||document.documentElement).appendChild(s);}})();\n";
    }
}
