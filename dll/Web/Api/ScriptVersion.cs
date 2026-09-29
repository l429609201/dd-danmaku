namespace DD.Danmaku.Web.Api;

using System.Text;

/// <summary>只读取当前 DLL 内嵌脚本头，版本缺失时不冒用程序集版本。</summary>
internal static class ScriptVersion
{
    private static readonly Lazy<string?> Cached = new(Read);
    internal static string? Current => Cached.Value;

    private static string? Read()
    {
        using var stream = typeof(ScriptVersion).Assembly.GetManifestResourceStream("DD.Danmaku.Resources/ede.js");
        if (stream is null) return null;
        using var reader = new StreamReader(stream, Encoding.UTF8, true);
        // 元数据位于文件头；限制读取范围，不扫描整个播放器脚本。
        for (var index = 0; index < 80 && reader.ReadLine() is { } line; index++)
        {
            const string marker = "// @version";
            var text = line.Trim();
            if (!text.StartsWith(marker, StringComparison.Ordinal)) continue;
            var value = text[marker.Length..].Trim();
            return value.Length is > 0 and <= 64 && !value.Any(char.IsWhiteSpace) ? value : null;
        }
        return null;
    }
}
