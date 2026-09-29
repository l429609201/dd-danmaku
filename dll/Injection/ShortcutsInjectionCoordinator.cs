namespace DD.Danmaku.Injection;

using System.Reflection;

/// <summary>为神医与无神医两种环境统一生成 shortcuts.js 的追加结果。</summary>
public static class ShortcutsInjectionCoordinator
{
    private const string ShenyiTypeName = "StrmAssistant.Web.Helper.ShortcutMenuHelper";
    private const string ShenyiPropertyName = "ModifiedShortcutsString";

    /// <summary>尝试读取神医已经生成的完整脚本；失败时返回空值。</summary>
    public static string? TryGetShenyiScript()
    {
        var type = AppDomain.CurrentDomain.GetAssemblies()
            .Select(a => a.GetType(ShenyiTypeName, throwOnError: false))
            .FirstOrDefault(t => t is not null);
        var property = type?.GetProperty(ShenyiPropertyName,
            BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static);
        return property?.GetValue(null) as string;
    }

    /// <summary>将追加结果写回神医属性；失败时不触碰神医原文。</summary>
    public static bool TryPatchShenyi(string resourceUrl)
    {
        try
        {
            var type = AppDomain.CurrentDomain.GetAssemblies()
                .Select(a => a.GetType(ShenyiTypeName, throwOnError: false))
                .FirstOrDefault(t => t is not null);
            var property = type?.GetProperty(ShenyiPropertyName,
                BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static);
            if (property?.CanRead != true || property.GetValue(null) is not string original
                || string.IsNullOrEmpty(original) || !property.CanWrite) return false;
            property.SetValue(null, Append(original, resourceUrl));
            return true;
        }
        catch (Exception)
        {
            // 神医版本变化时跳过定向适配，不能阻断 DD 插件启动。
            return false;
        }
    }


    /// <summary>保留原脚本，仅在末尾追加 DD 启动段。</summary>
    public static string Append(string original, string resourceUrl)
        => BootstrapInjector.Append(original, resourceUrl);
}
