namespace DD.Danmaku.Injection;

public static class PathMatcher
{
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

public static class BootstrapInjector
{
    public const string Marker = "/* dd-danmaku-bootstrap:v1 */";

    public static string Append(string original, string resourceUrl)
    {
        if (original.Contains(Marker, StringComparison.Ordinal)) return original;
        return original + "\n" + Marker + "\n" +
            $";(function(){{if(window.__ddDanmakuBootstrapLoaded)return;window.__ddDanmakuBootstrapLoaded=true;var s=document.createElement('script');s.src='{resourceUrl}';s.charset='utf-8';s.onerror=function(){{window.__ddDanmakuBootstrapLoaded=false;}};(document.head||document.documentElement).appendChild(s);}})();\n";
    }
}
